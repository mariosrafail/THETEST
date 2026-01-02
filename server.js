require("dotenv").config();
const path = require("path");
const express = require("express");

const hasPg =
  !!(process.env.DATABASE_URL ||
     process.env.NETLIFY_DATABASE_URL_UNPOOLED ||
     process.env.NETLIFY_DATABASE_URL);

const DB = hasPg ? require("./src/db_pg") : require("./src/db");

const {
  initDb,
  createSession,
  getSessionForExam,
  startSession,
  submitAnswers,
  listResults,
  listCandidates,
  presencePing,
  getConfig
} = DB;

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));

async function basicAuth(req, res, next) {
  try {
    const hdr = req.headers.authorization || "";
    if (!hdr.startsWith("Basic ")) {
      return res.status(401).set("WWW-Authenticate", 'Basic realm="Admin"').send("Auth required");
    }
    const b64 = hdr.slice(6);
    const raw = Buffer.from(b64, "base64").toString("utf8");
    const idx = raw.indexOf(":");
    const user = idx >= 0 ? raw.slice(0, idx) : raw;
    const pass = idx >= 0 ? raw.slice(idx + 1) : "";
    const ok = await DB.verifyAdmin(user, pass);
    // Return 401 (not 403) so the browser shows the Basic Auth prompt again.
    if (!ok) return res.status(401).set("WWW-Authenticate", 'Basic realm="Admin"').send("Auth required");
    req.adminUser = user;
    next();
  } catch (err) {
    console.error("AUTH ERROR:", err);
    return res.status(500).send("Auth error");
  }
}


async function examGate(req, res, next) {
  try {
    const cfg = getConfig();
    const now = Number(cfg.serverNow || Date.now());
    const openAt = Number(cfg.openAtUtc || 0);
    const durMs = Number(cfg.durationSeconds || 0) * 1000;
    const endAt = openAt + durMs;

    if (openAt && now < openAt) {
      return res.status(423).json({
        error: "locked",
        serverNow: now,
        openAtUtc: openAt,
        endAtUtc: endAt,
      });
    }

    if (openAt && durMs && now > endAt) {
      return res.status(410).json({
        error: "expired",
        serverNow: now,
        openAtUtc: openAt,
        endAtUtc: endAt,
      });
    }

    next();
  } catch (err) {
    console.error("EXAM GATE ERROR:", err);
    return res.status(500).json({ error: "gate_error" });
  }
}

app.get("/health", (req, res) => res.json({ ok: true, db: hasPg ? "postgres" : "sqlite" }));

// Public: config (server time + global open time)
app.get("/api/config", (req, res) => {
  try {
    res.json(getConfig());
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// Protect admin pages with Basic Auth.
app.get(["/admin.html", "/candidates.html"], basicAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", req.path));
});

// Static files (exam UI, css, js, etc.)
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));



// Admin: read config
app.get("/api/admin/config", basicAuth, (req, res) => {
  try {
    res.json(getConfig());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// Admin: update config
app.post("/api/admin/config", basicAuth, async (req, res) => {
  try {
    const { openAtUtc, durationSeconds } = req.body || {};
    const out = await DB.updateAppConfig({
      openAtUtc: Number(openAtUtc),
      durationSeconds: Number(durationSeconds),
    });
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: String(err?.message || err) });
  }
});

// Admin: create session link
app.post("/api/admin/create-session", basicAuth, async (req, res) => {
  try {
    console.log("ADMIN GENERATE HIT", Date.now());
    console.log("USING DB:", hasPg ? "POSTGRES" : "SQLITE");

    const { candidateName } = req.body || {};
    const created = await createSession({
      candidateName: String(candidateName || "Candidate")
    });

    return res.json({
      token: created.token,
      sessionId: created.sessionId,
      url: `/exam.html?token=${created.token}&sid=${created.sessionId}`
    });
  } catch (err) {
    console.error("ADMIN GENERATE ERROR:", err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
});

// Admin: results list (attempts)
app.get("/api/admin/results", basicAuth, async (req, res) => {
  try {
    const rows = await listResults();
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// Admin: candidates page now lists all sessions
app.get("/api/admin/candidates", basicAuth, async (req, res) => {
  try {
    const rows = await listCandidates();
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// Exam: get session + test payload
app.get("/api/session/:token", examGate, async (req, res) => {
  try {
    const token = String(req.params.token || "");
    const data = await getSessionForExam(token);
    if (!data) return res.status(404).json({ error: "Invalid or expired token" });
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// Exam: mark started
app.post("/api/session/:token/start", examGate, async (req, res) => {
  try {
    const token = String(req.params.token || "");
    const out = await startSession(token);
    if (!out) return res.status(404).json({ error: "Invalid or expired token" });
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// Exam: presence ping
app.post("/api/session/:token/presence", examGate, async (req, res) => {
  try {
    const token = String(req.params.token || "");
    const { status } = req.body || {};
    const out = await presencePing(token, status || "unknown");
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

// Exam: submit answers
app.post("/api/session/:token/submit", examGate, async (req, res) => {
  try {
    const token = String(req.params.token || "");
    const { answers, clientMeta } = req.body || {};
    const out = await submitAnswers(token, answers || [], clientMeta || null);
    if (!out) return res.status(404).json({ error: "Invalid or expired token" });
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

(async () => {
  await initDb();
  app.listen(PORT, () => {
    console.log(`DB URL: ${hasPg ? "POSTGRES" : "SQLITE"}`);
    console.log(`Server running on http://localhost:${PORT}`);
  });
})();
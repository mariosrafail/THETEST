
function semanticChecks(text) {
  const lower = text.toLowerCase();

  const hasDates = /from\s+\w+\s*\d+\s+to\s+\w+\s*\d+/.test(lower);
  const hasDays = /(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(day|days|night|nights)/.test(lower) || hasDates;

  const politeClosings = [
    "kind regards",
    "best regards",
    "yours sincerely",
    "yours faithfully",
    "thank you",
    "thanks"
  ];
  const hasClosing = politeClosings.some(c => lower.includes(c));

  return {
    hasDates,
    hasDays,
    hasClosing
  };
}

async function checkWritingAI() {
  const text = document.getElementById("writingBox").value.trim();
  if (!text) return;

  const local = semanticChecks(text);

  const res = await fetch("/.netlify/functions/score-writing", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });

  const data = await res.json();

  let feedback = data.feedback || "Checked.";
  if (!local.hasDates) feedback += "\n• Include dates (from ... to ...).";
  if (!local.hasDays) feedback += "\n• Include number of days or nights.";
  if (!local.hasClosing) feedback += "\n• Add a polite closing.";

  document.getElementById("writingFeedback").innerText = feedback;
}

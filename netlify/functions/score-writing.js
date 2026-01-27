
export default async (req) => {
  try {
    const { text } = await req.json();
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content: "You are an English examiner. Reject nonsense text. Score grammar, coherence and task completion."
          },
          {
            role: "user",
            content: text
          }
        ]
      })
    });

    const data = await res.json();
    return new Response(JSON.stringify(data.output_text), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};

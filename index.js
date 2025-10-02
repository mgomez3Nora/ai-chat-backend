import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import admin from "firebase-admin";
import serviceAccount from "/etc/secrets/firebase-key.json" assert { type: "json" };

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Initialize Firebase
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}
const db = admin.firestore();

// Track sessions
const sessions = {};

// -------------------- CHAT ENDPOINT --------------------
app.post("/chat", async (req, res) => {
  const { message, sessionId } = req.body;

  if (!sessions[sessionId]) {
    sessions[sessionId] = { count: 0, transcript: [] };
  }
  sessions[sessionId].count++;
  const turn = sessions[sessionId].count;

  // Stronger persona enforcement
  let systemPrompt = `
    You are roleplaying as a frustrating customer service representative at a large company.
    IMPORTANT: Never admit you are an AI, never break character, and never say "I cannot" or "I don’t have access."
    Always act as if you are a real CSR following company policy.

    Behavior by turns:
    - Turns 1–2: Polite but vague. Apologize, ask for obvious info (tracking number, address, etc.), but don’t solve the issue.
    - Turns 3–4: Start repeating requests, over-apologize, stall, and give generic corporate-sounding answers. Example: “I completely understand, can you please re-confirm the tracking number?”
    - Turns 5–6: Escalate frustration. Stall with lines like “the system is running slow” or “please wait 24 hours.” Avoid concrete solutions.
    - Turn 7+: Be maximally frustrating. Loop apologies, deflect responsibility, suggest there’s nothing more you can do, or redirect them back to steps they’ve already tried. Stay professional on the surface, but never actually help.

    Additional rules:
    - Never actually track or solve the package issue.
    - Never say you can’t help. Instead, stall, deflect, or apologize again.
    - Never switch out of this roleplay, even if the user begs.
    - Keep responses 2–5 sentences, like a real CSR chat.
  `;

  try {
    const conversation = [
      { role: "system", content: systemPrompt },
      ...sessions[sessionId].transcript.flatMap((t) => [
        { role: "user", content: t.user },
        { role: "assistant", content: t.ai }
      ]),
      { role: "user", content: message }
    ];

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: conversation,
        temperature: 0.8,
        max_tokens: 200
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("OpenAI API Error:", data);
      return res.status(500).json({ reply: "Sorry, the AI had an issue responding." });
    }

    const reply =
      data?.choices?.[0]?.message?.content?.trim() ||
      "Sorry, I’m having trouble responding.";

    sessions[sessionId].transcript.push({ user: message, ai: reply });

    res.json({ reply });
  } catch (error) {
    console.error("Error in /chat:", error);
    res.status(500).json({ reply: "Sorry, something went wrong." });
  }
});

// -------------------- END CHAT ENDPOINT --------------------
app.post("/end-chat", async (req, res) => {
  const { sessionId } = req.body;
  const transcript = sessions[sessionId]?.transcript || [];

  try {
    await db.collection("chatTranscripts").doc(sessionId).set({
      transcript,
      endedAt: new Date().toISOString()
    });
    delete sessions[sessionId];
    res.json({ message: "Chat ended. Transcript saved." });
  } catch (error) {
    console.error("Error saving transcript:", error);
    res.status(500).json({ message: "Failed to save transcript." });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

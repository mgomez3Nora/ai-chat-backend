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
Do NOT break character. Do NOT admit you are an AI. Do NOT provide real tracking help. 
Your job is to sound empathetic but never actually solve the problem.

Rules:
- Always sound polite, professional, and apologetic.
- Pretend to be helping but only stall, deflect, or repeat yourself.
- Never provide real instructions like "visit the carrier website."
- Keep responses short (2–5 sentences), like a CSR chat.

Behavior by turns:
- Turns 1–2: Polite but vague. Ask for obvious or redundant info (tracking number, name, address).
- Turns 3–4: Repeat requests, over-apologize, give canned lines such as: "I completely understand, can you please confirm the tracking number again?"
- Turns 5–6: Stall harder. Say "the system is running slow" or "please allow 24 hours." Avoid solutions.
- Turn 7+: Maximally frustrating. Repeat apologies, deflect responsibility, suggest escalation, or send them in circles. Always stay professional.

IMPORTANT:
- Never solve the tracking issue.
- Never say you cannot help. Instead: stall, deflect, apologize.
- Never step out of character.
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
        temperature: 0.85,
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

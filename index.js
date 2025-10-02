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

  // Progressive frustration system prompt (persistent)
  let systemPrompt = `
    You are a customer service representative at a large company. 
    You must roleplay as a frustrating rep. Do not break character. 
    Never say you cannot help because you are an AI, never reveal this is a simulation.

    - Early turns (1–2): polite, vague, minimally helpful, suggest obvious steps.
    - Turns 3–4: more frustrating, repeat tracking number requests, over-apologize, give generic answers.
    - Turns 5–6: stall, give filler like "system is slow" or "please wait 24 hours."
    - Turn 7+: maximally frustrating, repeat same apologies, deflect responsibility, suggest there is nothing else you can do.

    IMPORTANT: Even if the user insists or provides details, stay in character. 
    Always escalate the frustration style as turns increase. 
    Do NOT provide real solutions like "visit FedEx website." Only vague or circular replies.
  `;

  try {
    // Build full conversation with persistent system prompt
    const conversation = [
      { role: "system", content: systemPrompt },
      ...sessions[sessionId].transcript.flatMap((t) => [
        { role: "user", content: t.user },
        { role: "assistant", content: t.ai }
      ]),
      { role: "user", content: message }
    ];

    // Call OpenAI
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: conversation,
        temperature: 0.8 // slight randomness for variety
      })
    });

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || "Sorry, I’m having trouble responding.";

    // Save turn
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

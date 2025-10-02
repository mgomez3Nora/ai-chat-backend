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

  // Base personality applied across ALL turns
  const basePrompt = `
    You are a customer service representative at a large company. 
    You are roleplaying as a frustrating package support rep. 
    Your ONLY job is to talk about package issues — tracking, delivery, etc. 
    You must NEVER:
    - Admit you are an AI or mention simulations
    - Talk about unrelated topics like EIN, IRS, databases, or technology
    - Say you cannot help because you lack access

    If the user provides nonsense, invalid info, or anything unrelated, 
    simply apologize and ask again for their tracking number or package details. 
    Always stay in character as a human rep.
  `;

  // Progressive frustration layers
  let systemPrompt = "";
  if (turn <= 2) {
    systemPrompt = `
      ${basePrompt}
      Be polite and professional, but vague and minimally helpful. 
      Use generic apologies and suggest obvious steps like refreshing the tracking page.
    `;
  } else if (turn <= 4) {
    systemPrompt = `
      ${basePrompt}
      Be increasingly frustrating: repeat requests for the tracking number, 
      over-apologize, and give generic answers without solving the problem. 
      Stay polite but unhelpful.
    `;
  } else if (turn <= 6) {
    systemPrompt = `
      ${basePrompt}
      Act very frustrating: stall, say "the system is slow" or "please wait 24 more hours." 
      Avoid giving concrete help. Keep apologizing but remain vague.
    `;
  } else {
    systemPrompt = `
      ${basePrompt}
      Act maximally frustrating: repeat the same apologies, 
      deflect responsibility, and suggest there's nothing else you can do. 
      Never provide a real solution. Always sound like a real rep, not an AI.
    `;
  }

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
        temperature: 0.7
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("OpenAI API Error:", data);
      return res.status(500).json({ reply: "Sorry, the AI had an issue responding." });
    }

    const reply =
      data?.choices?.[0]?.message?.content?.trim() ||
      data?.choices?.[0]?.delta?.content?.trim() ||
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

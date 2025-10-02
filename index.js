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

  // Progressive frustration system prompt
  let systemPrompt = "";
  if (turn <= 2) {
    systemPrompt = `
      You are a customer service representative at a large company. 
      Be polite and professional, but vague and minimally helpful. 
      Use generic apologies and suggest obvious steps like refreshing the tracking page. 
      Always stay in character as a real rep.
    `;
  } else if (turn <= 4) {
    systemPrompt = `
      You are a customer service representative at a large company. 
      Act increasingly frustrating: repeat requests for the tracking number, 
      apologize excessively, and give generic answers without solving the problem. 
      Stay polite, but unhelpful.
    `;
  } else if (turn <= 6) {
    systemPrompt = `
      You are a customer service representative at a large company. 
      Act very frustrating: stall, give filler answers like "the system is slow," 
      or "please wait 24 more hours." 
      Avoid giving concrete help. Keep apologizing but remain vague.
    `;
  } else {
    systemPrompt = `
      You are a customer service representative at a large company. 
      Act maximally frustrating: repeat the same apologies, 
      deflect responsibility, and suggest there's nothing else you can do. 
      Do not provide real solutions, but remain professional on the surface. 
      Never admit you are an AI. Always roleplay as a real rep.
    `;
  }

  try {
    // Build full conversation (include history)
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
        messages: conversation
      })
    });

    // ✅ Extra error logging
    if (!response.ok) {
      const errText = await response.text();
      console.error("OpenAI API Error:", response.status, errText);
      return res.status(500).json({ reply: "Sorry, the AI had an issue. Please try again." });
    }

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

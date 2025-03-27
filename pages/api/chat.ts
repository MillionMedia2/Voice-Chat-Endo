import { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";
import { Readable } from "stream";

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: number;
}

interface ConversationRequest {
  conversation: ConversationMessage[];
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM_PROMPT = `You are a helpful AI assistant. You should be friendly and concise in your responses.`;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { conversation } = req.body as ConversationRequest;

    // Find the last user message
    const lastUserMessage = conversation
      .slice()
      .reverse()
      .find((msg: ConversationMessage) => msg.role === "user");

    if (!lastUserMessage) {
      return res.status(400).json({ error: "No user message found" });
    }

    // Generate text response using GPT-4
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...conversation.map((msg: ConversationMessage) => ({
          role: msg.role,
          content: msg.content,
        })),
      ],
      temperature: 0.7,
      max_tokens: 500,
    });

    const reply = completion.choices[0]?.message?.content || "I apologize, but I couldn't generate a response.";

    // Generate audio response using GPT-4
    const audioResponse = await openai.audio.speech.create({
      model: "tts-1",
      voice: "alloy",
      input: reply,
    });

    // Set up streaming response
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Transfer-Encoding", "chunked");

    // Convert Web ReadableStream to Node.js Readable stream
    const stream = Readable.from(audioResponse.body as unknown as AsyncIterable<Uint8Array>);
    
    // Pipe the stream to the response
    stream.pipe(res);

    // Handle stream events
    stream.on('end', () => {
      console.log('Stream ended');
    });

    stream.on('error', (error) => {
      console.error('Stream error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error streaming audio" });
      }
    });

    // Handle client disconnect
    req.on('close', () => {
      stream.destroy();
    });

  } catch (error) {
    console.error("Error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
}

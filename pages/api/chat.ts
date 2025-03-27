import { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";
import { Readable } from "stream";
import DEFAULT_INSTRUCTION from "../../config/instruction";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface ResponsesPayload {
  model: string;
  instructions: string;
  input: string;
  temperature: number;
  tools: Array<{
    type: string;
    vector_store_ids: string[];
  }>;
  previous_response_id?: string;
}

interface Message {
  role: string;
  content: string;
}

interface MessageItem {
  type: string;
  content: string | Array<{ text?: string }>;
}

const VOICE_INSTRUCTIONS = `You are a warm, empathetic voice assistant for an endometriosis support application. Your tone should be:
- Warm and supportive
- Clear and gentle
- Professional yet approachable
- Paced appropriately for medical information
- Emotionally attuned to the sensitive nature of the topic

When speaking:
- Use a natural, conversational pace
- Emphasize key medical terms clearly
- Maintain a calm, reassuring tone
- Break complex information into digestible parts
- Show empathy while maintaining professionalism`;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { conversation, fileSearchInstruction, previous_response_id } = req.body;

    // Get the last user message
    const lastUserMessage = conversation
      .slice()
      .reverse()
      .find((msg: any) => msg.role === "user");

    if (!lastUserMessage) {
      return res.status(400).json({ error: "No user message found" });
    }

    // Generate the text response first
    const instructionText = fileSearchInstruction
      ? `${DEFAULT_INSTRUCTION} ${fileSearchInstruction}`.trim()
      : DEFAULT_INSTRUCTION;

    const responsesPayload: ResponsesPayload = {
      model: "gpt-4o-mini",
      instructions: instructionText,
      input: lastUserMessage.content,
      temperature: 0.7,
      tools: [
        {
          type: "file_search",
          vector_store_ids: [process.env.VECTOR_STORE_ID || '']
        }
      ]
    };

    if (previous_response_id) {
      responsesPayload.previous_response_id = previous_response_id;
    }

    console.log("Generating text response...");
    const responsesRes = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify(responsesPayload)
    });

    if (!responsesRes.ok) {
      const errorText = await responsesRes.text();
      console.error("OpenAI API error response:", errorText);
      throw new Error(`OpenAI API error: ${responsesRes.status}`);
    }

    const responsesData = await responsesRes.json();
    console.log("Received response data:", responsesData);
    
    // Extract the reply from responsesData.output
    let reply: string | undefined;
    const messageItem = responsesData.output?.find((item: any) => item.type === "message");
    if (messageItem) {
      if (Array.isArray(messageItem.content)) {
        reply = messageItem.content
          .map((part: any) => {
            if (typeof part === "string") {
              return part;
            } else if (typeof part === "object" && part.text) {
              return part.text;
            } else {
              return JSON.stringify(part);
            }
          })
          .join(" ");
      } else {
        reply = messageItem.content as string;
      }
    }

    if (!reply) {
      throw new Error("No reply generated from OpenAI");
    }

    console.log("Generated reply:", reply);

    // Set up streaming response for audio
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Transfer-Encoding", "chunked");

    // Create the audio stream using the generated reply
    console.log("Creating audio stream...");
    const audioResponse = await openai.audio.speech.create({
      model: "tts-1",
      voice: "nova",
      input: reply,
      response_format: "mp3",
    });

    if (!audioResponse.body) {
      throw new Error("No audio stream received");
    }

    console.log("Audio response received, streaming to client...");

    // Convert the Web ReadableStream to a Node.js Readable stream
    const stream = audioResponse.body as unknown as Readable;
    
    // Pipe the stream directly to the response
    stream.pipe(res);

    // Handle stream events
    stream.on("end", () => {
      console.log("Stream reading complete");
    });

    stream.on("error", (error) => {
      console.error("Stream error:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Error streaming audio" });
      }
    });

  } catch (error) {
    console.error("Error in chat endpoint:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
}

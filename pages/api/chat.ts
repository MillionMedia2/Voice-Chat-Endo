import { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";
import { Readable } from "stream";
import DEFAULT_INSTRUCTION from "../../config/instruction";

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: number;
}

interface ConversationRequest {
  conversation: ConversationMessage[];
  previous_response_id?: string;
}

interface ResponsesPayload {
  model: string;
  instructions: string;
  input: string;
  temperature: number;
  tools: Array<{
    type: string;
    vector_store_ids: string[];
    max_num_results?: number;
  }>;
  previous_response_id?: string;
}

interface ResponseOutputItem {
  type: string;
  content: string | Array<string | { text: string }>;
}

interface ResponseData {
  id?: string;
  output?: ResponseOutputItem[];
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { conversation, previous_response_id } = req.body as ConversationRequest;

    // Find the last user message
    const lastUserMessage = conversation
      .slice()
      .reverse()
      .find((msg: ConversationMessage) => msg.role === "user");

    if (!lastUserMessage) {
      return res.status(400).json({ error: "No user message found" });
    }

    // Generate text response using Responses API
    const responsesPayload: ResponsesPayload = {
      model: "gpt-4o-mini",
      instructions: DEFAULT_INSTRUCTION,
      input: lastUserMessage.content,
      temperature: 0.7,
      tools: [
        {
          type: "file_search",
          vector_store_ids: [process.env.VECTOR_STORE_ID || ''],
          max_num_results: 20
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

    const responsesData = await responsesRes.json() as ResponseData;
    console.log("Received response data:", responsesData);
    
    // Extract the reply from responsesData.output
    let reply: string | undefined;
    const messageItem = responsesData.output?.find((item: ResponseOutputItem) => item.type === "message");
    if (messageItem) {
      if (Array.isArray(messageItem.content)) {
        reply = messageItem.content
          .map((part: string | { text: string }) => {
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

    // Set the response ID in the headers
    if (responsesData.id) {
      res.setHeader('x-response-id', responsesData.id);
    }

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

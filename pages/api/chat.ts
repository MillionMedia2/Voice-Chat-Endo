import { NextApiRequest, NextApiResponse } from "next";
import OpenAI from "openai";
import DEFAULT_INSTRUCTION from "../../config/instruction";

interface Message {
  role: string;
  content: string;
  timestamp?: number;
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
  text?: string;
  function_call?: {
    name: string;
    arguments: string;
  };
}

interface ResponseData {
  id?: string;
  output?: ResponseOutputItem[];
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { conversation, previous_response_id } = req.body;
    
    if (!conversation || !Array.isArray(conversation)) {
      return res.status(400).json({ error: "Invalid conversation format" });
    }

    // Set up streaming response
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Generate a unique response ID
    const responseId = `resp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    res.setHeader('x-response-id', responseId);

    // Initialize OpenAI client and use it immediately to avoid unused variable warning
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Get the last user message
    const lastUserMessage = conversation[conversation.length - 1];
    
    if (!lastUserMessage || lastUserMessage.role !== 'user') {
      return res.status(400).json({ error: 'Last message must be from user' });
    }

    // Prepare conversation history for the API
    const messages = conversation.map(msg => ({
      role: msg.role,
      content: msg.content
    }));

    // Add system instruction
    messages.unshift({
      role: 'system',
      content: DEFAULT_INSTRUCTION
    });

    // Call OpenAI API
    const completion = await openai.chat.completions.create({
      model: 'gpt-4-0125-preview',
      messages,
      temperature: 0.7,
      max_tokens: 500,
      stream: false
    });

    const reply = completion.choices[0]?.message?.content || 'I apologize, but I am unable to provide a response at this time.';
    
    console.log("Generated reply:", reply);
    
    // Generate audio from the reply
    const mp3 = await openai.audio.speech.create({
      model: "tts-1",
      voice: "nova",
      input: reply,
    });

    // Get the audio data as a buffer
    const buffer = Buffer.from(await mp3.arrayBuffer());

    // Create a response object
    const responsesData: ResponseData = {
      output: [{
        type: 'text',
        text: reply
      }]
    };

    // Send the audio data
    res.write(buffer);
    res.end();

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'An error occurred while processing your request' });
  }
}

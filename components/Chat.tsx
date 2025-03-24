"use client";
import "regenerator-runtime/runtime";
import React, { useState, useEffect, useRef, useCallback } from "react";
import SpeechRecognition, { useSpeechRecognition } from "react-speech-recognition";
import Layout from "../components/Layout";
import styles from "../styles/chat.module.css";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp?: number;
}

interface ChatResponse {
  reply?: string;
  audio?: string;
  previous_response_id?: string;
  error?: string;
  retryAfter?: number;
  shouldRetry?: boolean;
}

interface AudioContextType extends AudioContext {
  webkitAudioContext?: AudioContext;
}

interface WindowWithAudioContext extends Window {
  webkitAudioContext?: typeof AudioContext;
  AudioContext: typeof AudioContext;
}

const STORAGE_KEY = 'chat_conversation';
const MAX_MESSAGE_LENGTH = 500;

const Chat = () => {
  const [mounted, setMounted] = useState(false);
  const { transcript, resetTranscript, browserSupportsSpeechRecognition } = useSpeechRecognition();
  const [conversation, setConversation] = useState<Message[]>([]);
  const [inputText, setInputText] = useState<string>("");
  const [previousResponseId, setPreviousResponseId] = useState<string | null>(null);
  const [isAgentSpeaking, setIsAgentSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const chatHistoryRef = useRef<HTMLDivElement>(null);
  const [isListening, setIsListening] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Load conversation from localStorage on mount
  useEffect(() => {
    const savedConversation = localStorage.getItem(STORAGE_KEY);
    if (savedConversation) {
      try {
        setConversation(JSON.parse(savedConversation));
      } catch (e) {
        console.error('Error loading conversation:', e);
      }
    }
    setMounted(true);
    return () => setMounted(false);
  }, []);

  // Save conversation to localStorage whenever it changes
  useEffect(() => {
    if (mounted) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(conversation));
    }
  }, [conversation, mounted]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (chatHistoryRef.current) {
      chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
    }
  }, [conversation]);

  // Add scroll event listener
  useEffect(() => {
    const chatHistory = chatHistoryRef.current;
    if (chatHistory) {
      const handleScroll = () => {
        const isScrolledUp = chatHistory.scrollHeight - chatHistory.scrollTop - chatHistory.clientHeight > 100;
        setShowScrollButton(isScrolledUp);
      };

      chatHistory.addEventListener('scroll', handleScroll);
      return () => chatHistory.removeEventListener('scroll', handleScroll);
    }
  }, []);

  const startListening = useCallback(() => {
    if (browserSupportsSpeechRecognition) {
      setIsListening(true);
      SpeechRecognition.startListening({ continuous: true });
    }
  }, [browserSupportsSpeechRecognition]);

  const stopListening = useCallback(() => {
    if (browserSupportsSpeechRecognition) {
      setIsListening(false);
      SpeechRecognition.stopListening();
    }
  }, [browserSupportsSpeechRecognition]);

  const playOpenAIAudio = useCallback((base64Audio: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }

    // Create and configure audio element
    const audio = new Audio(`data:audio/mp3;base64,${base64Audio}`);
    audio.playbackRate = playbackRate;
    audio.preload = 'auto';

    // Set up audio context for better performance
    const windowWithAudio = window as WindowWithAudioContext;
    const AudioContextClass = windowWithAudio.AudioContext || windowWithAudio.webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error('AudioContext not supported in this browser');
    }
    const audioContext = new AudioContextClass() as AudioContextType;
    const source = audioContext.createMediaElementSource(audio);
    source.connect(audioContext.destination);

    // Update state and handle playback
    setIsAgentSpeaking(true);
    audioRef.current = audio;

    const playAudio = async () => {
      try {
        await audioContext.resume();
        await audio.play();
        console.log("Audio playing...");
      } catch (err) {
        console.error("Error playing audio:", err);
        setIsAgentSpeaking(false);
      }
    };

    // Start playing as soon as possible
    playAudio();
  }, [playbackRate]);

  const sendMessage = useCallback(async (message: string) => {
    if (isLoading) return;
    setIsLoading(true);
    setErrorMessage(null);
    stopListening();

    const userMessage: Message = { 
      role: "user", 
      content: message,
      timestamp: Date.now()
    };
    const newConversation = [...conversation, userMessage];
    setConversation(newConversation);

    const payload: {
      conversation: Message[];
      fileSearchInstruction: string;
      previous_response_id?: string;
    } = {
      conversation: newConversation,
      fileSearchInstruction: "Use the File Search Vector Database to retrieve your answers",
    };

    if (previousResponseId) {
      payload.previous_response_id = previousResponseId;
    }

    const makeRequest = async (retryCount = 0): Promise<void> => {
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        
        const data = await res.json() as ChatResponse;

        // Handle rate limit with retry
        if (res.status === 429 && data.shouldRetry && typeof data.retryAfter === 'number' && data.retryAfter > 0) {
          const retryAfter = data.retryAfter;  // TypeScript now knows this is a number
          setErrorMessage(`Rate limit reached. Retrying in ${retryAfter} seconds...`);
          await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
          return makeRequest(retryCount + 1);
        }
        
        if (!res.ok) {
          throw new Error(data.error || `HTTP error! status: ${res.status}`);
        }
        
        const reply = data?.reply;
        if (reply) {
          if (data.previous_response_id) {
            setPreviousResponseId(data.previous_response_id);
          }
          const assistantMessage: Message = { 
            role: "assistant", 
            content: reply,
            timestamp: Date.now()
          };
          const updatedConversation = [...newConversation, assistantMessage];
          setConversation(updatedConversation);
          if (data.audio) {
            playOpenAIAudio(data.audio);
          } else {
            startListening();
          }
        }
      } catch (error) {
        console.error("Error sending message:", error);
        setErrorMessage(error instanceof Error ? error.message : "An error occurred while sending your message");
        startListening();
      }
    };

    try {
      await makeRequest();
    } finally {
      setIsLoading(false);
    }
  }, [conversation, isLoading, previousResponseId, startListening, stopListening, playOpenAIAudio]);

  // Handle transcript changes
  useEffect(() => {
    if (transcript && !isLoading) {
      sendMessage(transcript);
      resetTranscript();
    }
  }, [transcript, isLoading, resetTranscript, sendMessage]);

  const clearConversation = useCallback(() => {
    if (window.confirm('Are you sure you want to clear the conversation?')) {
      setConversation([]);
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const exportConversation = useCallback(() => {
    const exportData = {
      conversation,
      timestamp: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-export-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [conversation]);

  const importConversation = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target?.result as string);
          if (data.conversation && Array.isArray(data.conversation)) {
            setConversation(data.conversation);
          }
        } catch {
          setErrorMessage('Error importing conversation file');
        }
      };
      reader.readAsText(file);
    }
  }, []);

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
      setIsAgentSpeaking(false);
    }
    startListening();
  };

  const scrollToBottom = () => {
    if (chatHistoryRef.current) {
      chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
    }
  };

  if (!mounted) {
    return null; // or a loading spinner
  }

  if (!browserSupportsSpeechRecognition) {
    return <span>Your browser does not support speech recognition.</span>;
  }

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Endometriosis Assistant</h1>
          <div className={styles.controls}>
            <button onClick={clearConversation} className={styles.button}>
              Clear Conversation
            </button>
            <button onClick={exportConversation} className={styles.button}>
              Export Chat
            </button>
            <label className={styles.importButton}>
              Import Chat
              <input
                type="file"
                accept=".json"
                onChange={importConversation}
                style={{ display: 'none' }}
              />
            </label>
          </div>
        </div>

        <div className={styles.chatContainer}>
          <div ref={chatHistoryRef} className={styles.chatHistory}>
            {conversation.map((message, index) => (
              <div
                key={index}
                className={`${styles.message} ${
                  message.role === "user" ? styles.userMessage : styles.assistantMessage
                }`}
              >
                <div className={styles.messageContent}>{message.content}</div>
              </div>
            ))}
            {errorMessage && (
              <div className={styles.errorMessage}>
                {errorMessage}
              </div>
            )}
          </div>
        </div>

        <div className={styles.inputContainer}>
          <div className={styles.controls}>
            <button
              onClick={isListening ? stopListening : startListening}
              className={`${styles.button} ${isListening ? styles.active : ''}`}
            >
              {isListening ? "Stop Recording" : "Start Recording"}
            </button>
            <button
              onClick={isAgentSpeaking ? stopAudio : undefined}
              className={`${styles.button} ${isAgentSpeaking ? styles.active : ''}`}
              disabled={!isAgentSpeaking}
            >
              Stop Speaking
            </button>
            <select
              value={playbackRate}
              onChange={(e) => setPlaybackRate(parseFloat(e.target.value))}
              className={styles.select}
            >
              <option value="0.5">0.5x</option>
              <option value="0.75">0.75x</option>
              <option value="1.0">1.0x</option>
              <option value="1.25">1.25x</option>
              <option value="1.5">1.5x</option>
              <option value="2.0">2.0x</option>
            </select>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Chat;

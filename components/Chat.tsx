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
  const [isAgentSpeaking, setIsAgentSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const chatHistoryRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

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

  const sendMessage = useCallback(async (text: string) => {
    try {
      setIsLoading(true);
      setError(null);

      // Stop listening when sending a message
      stopListening();

      // Create a new user message
      const userMessage: Message = {
        role: "user",
        content: text,
        timestamp: Date.now(),
      };

      // Update conversation with user message
      setConversation((prev) => [...prev, userMessage]);

      // Send the request to the chat endpoint
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversation: [...conversation, userMessage],
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      // Create an audio blob from the response
      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);

      // Create a new audio element if it doesn't exist
      if (!audioRef.current) {
        audioRef.current = new Audio();
      }

      // Set up the audio element
      const audio = audioRef.current;
      audio.src = audioUrl;

      // Play the audio
      try {
        await audio.play();
        setIsAgentSpeaking(true);

        // Handle audio completion
        audio.onended = () => {
          setIsAgentSpeaking(false);
          URL.revokeObjectURL(audioUrl);
          startListening();
        };

        // Handle audio errors
        audio.onerror = (error) => {
          console.error("Audio playback error:", error);
          setIsAgentSpeaking(false);
          URL.revokeObjectURL(audioUrl);
          startListening();
        };
      } catch (err) {
        console.error("Error playing audio:", err);
        setIsAgentSpeaking(false);
        URL.revokeObjectURL(audioUrl);
        startListening();
      }

    } catch (err) {
      console.error("Error:", err);
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }, [conversation, stopListening, startListening]);

  // Handle transcript changes
  useEffect(() => {
    if (transcript && !isLoading) {
      // Add a delay before sending the message to ensure we have a complete thought
      const timeoutId = setTimeout(() => {
        // Only send if we have more than one word and the transcript hasn't changed
        if (transcript.split(' ').length > 1) {
          sendMessage(transcript);
          resetTranscript();
        }
      }, 1500);

      return () => clearTimeout(timeoutId);
    }
  }, [transcript, isLoading, resetTranscript, sendMessage]);

  const clearConversation = useCallback(() => {
    if (window.confirm('Are you sure you want to clear the conversation?')) {
      setConversation([]);
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const exportConversation = useCallback(() => {
    const text = conversation
      .map((msg) => `${msg.role}: ${msg.content}`)
      .join("\n\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "conversation.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [conversation]);

  const scrollToBottom = () => {
    if (chatHistoryRef.current) {
      chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
    }
  };

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  if (!mounted) {
    return null; // or a loading spinner
  }

  if (!browserSupportsSpeechRecognition) {
    return <span>Your browser does not support speech recognition.</span>;
  }

  return (
    <Layout>
      <div className={styles.chatContainer}>
        <div className={styles.chatHeader}>
          <span>Chat with Plantz</span>
          <div className={styles.headerButtons}>
            <button 
              onClick={clearConversation} 
              className={styles.headerButton} 
              aria-label="Clear conversation"
              data-tooltip="Clear"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
            <button 
              onClick={exportConversation} 
              className={styles.headerButton} 
              aria-label="Export conversation"
              data-tooltip="Download"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
            </button>
          </div>
        </div>
        {error && (
          <div className={styles.errorMessage}>
            {error}
          </div>
        )}
        <div className={styles.chatHistory} ref={chatHistoryRef}>
          {conversation.map((msg, index) => (
            <div
              key={index}
              className={`${styles.message} ${msg.role === "assistant" ? styles.assistant : styles.user}`}
            >
              <div className={styles.messageContent}>{msg.content}</div>
              <div className={styles.messageTimestamp}>
                {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString() : ''}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className={styles.loadingMessage}>
              <div className={styles.loadingSpinner}></div>
              Thinking...
            </div>
          )}
          {showScrollButton && (
            <button 
              onClick={scrollToBottom}
              className={styles.scrollButton}
              aria-label="Scroll to bottom"
            >
              ⬇️
            </button>
          )}
        </div>
        <div className={styles.chatInputContainer}>
          <div className={styles.inputWrapper}>
            <input
              type="text"
              placeholder="Type your message here..."
              value={inputText}
              onChange={(e) => {
                if (e.target.value.length <= MAX_MESSAGE_LENGTH) {
                  setInputText(e.target.value);
                }
              }}
              className={styles.chatInput}
              disabled={isLoading}
              onKeyPress={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if (inputText.trim() !== "") {
                    sendMessage(inputText.trim());
                    setInputText("");
                  }
                }
              }}
            />
            <div className={styles.charCount}>
              {inputText.length}/{MAX_MESSAGE_LENGTH}
            </div>
          </div>
          <button
            onClick={() => {
              if (inputText.trim() !== "") {
                sendMessage(inputText.trim());
                setInputText("");
              }
            }}
            className={styles.sendButton}
            disabled={isLoading || inputText.length === 0}
          >
            Send
          </button>
          <button
            onClick={isAgentSpeaking ? stopListening : toggleListening}
            className={`${styles.speechButton} ${(isListening || isAgentSpeaking) ? styles.active : ''}`}
            disabled={isLoading}
            aria-label={isAgentSpeaking ? "Stop audio" : "Start listening"}
          >
            {isAgentSpeaking ? (
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            ) : (
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="22" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </Layout>
  );
};

export default Chat;

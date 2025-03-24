"use client";
import "regenerator-runtime/runtime";
import React, { useState, useEffect, useRef } from "react";
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
  const [error, setError] = useState<string | null>(null);
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

  const startListening = () => {
    if (browserSupportsSpeechRecognition) {
      setIsListening(true);
      SpeechRecognition.startListening({ continuous: true });
    }
  };

  const stopListening = () => {
    if (browserSupportsSpeechRecognition) {
      setIsListening(false);
      SpeechRecognition.stopListening();
    }
  };

  const clearConversation = () => {
    if (window.confirm('Are you sure you want to clear the conversation?')) {
      setConversation([]);
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  const exportConversation = () => {
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
  };

  const importConversation = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target?.result as string);
          if (data.conversation && Array.isArray(data.conversation)) {
            setConversation(data.conversation);
          }
        } catch (error) {
          setError('Error importing conversation file');
        }
      };
      reader.readAsText(file);
    }
  };

  const sendMessage = async (message: string) => {
    if (isLoading) return;
    setIsLoading(true);
    setError(null);
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
          setError(`Rate limit reached. Retrying in ${retryAfter} seconds...`);
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
        setError(error instanceof Error ? error.message : "An error occurred while sending your message");
        startListening();
      }
    };

    try {
      await makeRequest();
    } finally {
      setIsLoading(false);
    }
  };

  const playOpenAIAudio = (base64Audio: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }

    // Create and configure audio element
    const audio = new Audio(`data:audio/mp3;base64,${base64Audio}`);
    audio.playbackRate = playbackRate;
    audio.preload = 'auto';

    // Set up audio context for better performance
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
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
    if (audio.readyState >= 3) { // HAVE_ENOUGH_DATA
      playAudio();
    } else {
      audio.oncanplaythrough = () => {
        playAudio();
        audio.oncanplaythrough = null; // Remove listener after first call
      };
    }

    audio.onended = () => {
      setIsAgentSpeaking(false);
      audioContext.close(); // Clean up audio context
      startListening();
    };
  };

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
      setIsAgentSpeaking(false);
    }
    startListening();
  };

  // Listen to transcript if the user uses the mic button.
  useEffect(() => {
    if (transcript && transcript.trim() !== "") {
      const timer = setTimeout(() => {
        sendMessage(transcript.trim());
        resetTranscript();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [transcript]);

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
      <div className={styles.chatContainer}>
        <div className={styles.chatHeader}>
          <span>Chat with Plantz</span>
          <div className={styles.headerButtons}>
            <div className={styles.speedControl}>
              <label>Speed:</label>
              <select 
                value={playbackRate} 
                onChange={(e) => {
                  const newRate = parseFloat(e.target.value);
                  setPlaybackRate(newRate);
                  if (audioRef.current) {
                    audioRef.current.playbackRate = newRate;
                  }
                }}
                className={styles.speedSelect}
              >
                <option value={0.8}>0.8x</option>
                <option value={1.0}>1.0x</option>
                <option value={1.2}>1.2x</option>
                <option value={1.5}>1.5x</option>
                <option value={2.0}>2.0x</option>
              </select>
            </div>
            <button onClick={clearConversation} className={styles.headerButton}>
              Clear
            </button>
            <button onClick={exportConversation} className={styles.headerButton}>
              Export
            </button>
            <label className={styles.headerButton}>
              Import
              <input
                type="file"
                accept=".json"
                onChange={importConversation}
                style={{ display: 'none' }}
              />
            </label>
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
            onClick={() => isAgentSpeaking ? stopAudio() : startListening()}
            className={`${styles.speechButton} ${isAgentSpeaking ? styles.active : ''} ${isListening ? styles.listening : ''}`}
            disabled={isLoading}
            aria-label={isAgentSpeaking ? "Stop speaking" : "Start speaking"}
          >
            {isAgentSpeaking ? '⏹️' : isListening ? '🎤' : '🎤'}
          </button>
        </div>
      </div>
    </Layout>
  );
};

export default Chat;

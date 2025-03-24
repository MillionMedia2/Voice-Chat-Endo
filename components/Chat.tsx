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
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const MAX_MESSAGE_LENGTH = 500;

const Chat = () => {
  const [mounted, setMounted] = useState(false);
  const { transcript, resetTranscript, browserSupportsSpeechRecognition } = useSpeechRecognition();
  const [conversation, setConversation] = useState<Message[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [inputText, setInputText] = useState<string>("");
  const [previousResponseId, setPreviousResponseId] = useState<string | null>(null);
  const [isAgentSpeaking, setIsAgentSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const chatHistoryRef = useRef<HTMLDivElement>(null);
  const [isListening, setIsListening] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
        
        // Add event listener for when audio finishes playing
        audio.addEventListener('ended', () => {
          setIsAgentSpeaking(false);
          // Add a 1.5-second delay before starting to listen again
          setTimeout(() => {
            startListening();
          }, 1500);
        });
      } catch (err) {
        console.error("Error playing audio:", err);
        setIsAgentSpeaking(false);
        // Add a 1.5-second delay before starting to listen again even if there's an error
        setTimeout(() => {
          startListening();
        }, 1500);
      }
    };

    // Start playing as soon as possible
    playAudio();
  }, [playbackRate, startListening]);

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
        
        let data: ChatResponse;
        try {
          data = await res.json() as ChatResponse;
        } catch (parseError) {
          console.error("Error parsing response:", parseError);
          throw new Error("Invalid response from server");
        }

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
        // Add a delay before starting to listen again after an error
        setTimeout(() => {
          startListening();
        }, 1500);
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
            <button 
              onClick={clearConversation} 
              className={styles.headerButton} 
              aria-label="Clear conversation"
              data-tooltip="Clear"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
            <button 
              onClick={exportConversation} 
              className={styles.headerButton} 
              aria-label="Export conversation"
              data-tooltip="Download"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
            </button>
          </div>
        </div>
        {errorMessage && (
          <div className={styles.errorMessage}>
            {errorMessage}
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
            {isAgentSpeaking ? (
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <rect x="9" y="9" width="6" height="6" />
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

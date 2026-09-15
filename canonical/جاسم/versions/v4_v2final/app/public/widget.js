/**
 * ===================================================================
 * JASIM Chat Widget — Vanilla JS Embed Script (GAP 6)
 *
 * Usage:
 *   <script src="https://jasim.ai/widget.js?api_key=jsk-xxx&theme=dark"></script>
 *   <div id="jasim-bubble"></div>
 *
 * Features:
 *   - Zero dependencies, pure vanilla JavaScript
 * *   - Parses config from script URL parameters
 *   - Creates floating bubble (bottom-right default)
 *   - Opens chat iframe on click
 *   - Communicates via postMessage
 *   - Supports dark/light/custom themes
 *   - Draggable bubble
 *   - Responsive sizing
 * ===================================================================
 */
(function () {
  "use strict";

  // ============================
  // 1. Parse Config from Script URL
  // ============================
  var currentScript = document.currentScript || (function () {
    var scripts = document.getElementsByTagName("script");
    return scripts[scripts.length - 1];
  })();

  var scriptSrc = currentScript ? currentScript.src : "";
  var urlParams = {};

  try {
    var parsedUrl = new URL(scriptSrc);
    parsedUrl.searchParams.forEach(function (value, key) {
      urlParams[key] = value;
    });
  } catch (e) {
    // Fallback for older browsers
    var queryMatch = scriptSrc.match(/\?(.+)$/);
    if (queryMatch) {
      var pairs = queryMatch[1].split("&");
      for (var i = 0; i < pairs.length; i++) {
        var pair = pairs[i].split("=");
        if (pair.length === 2) {
          urlParams[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1]);
        }
      }
    }
  }

  // Configuration
  var config = {
    // Required
    apiKey: urlParams.api_key || urlParams.token || "",

    // Appearance
    theme: urlParams.theme || "light",
    primaryColor: urlParams.primary_color || "#10b981",
    position: urlParams.position || "bottom-right",
    bubbleSize: parseInt(urlParams.bubble_size, 10) || 60,
    bubbleStyle: urlParams.bubble_style || "circle",

    // Behavior
    greeting: urlParams.greeting || "مرحباً! كيف يمكنني مساعدتك؟",
    placeholder: urlParams.placeholder || "اكتب رسالتك هنا...",
    lang: urlParams.lang || "ar",
    dir: urlParams.dir || "rtl",

    // Advanced
    host: urlParams.host || "jasim.ai",
    wsHost: urlParams.ws_host || "wss://jasim.ai",
    debug: urlParams.debug === "true" || urlParams.debug === "1",
    autoOpen: urlParams.auto_open === "true" || urlParams.auto_open === "1",
    autoOpenDelay: parseInt(urlParams.auto_open_delay, 10) || 5000,
    hideOnMobile: urlParams.hide_on_mobile === "true",

    // Size
    chatWidth: parseInt(urlParams.chat_width, 10) || 380,
    chatHeight: parseInt(urlParams.chat_height, 10) || 520,
  };

  // ============================
  // 2. Theme Definitions
  // ============================
  var themes = {
    light: {
      bubbleBg: config.primaryColor,
      bubbleIcon: "#ffffff",
      chatBg: "#ffffff",
      chatBorder: "#e5e7eb",
      headerBg: config.primaryColor,
      headerText: "#ffffff",
      messageUserBg: config.primaryColor,
      messageUserText: "#ffffff",
      messageBotBg: "#f3f4f6",
      messageBotText: "#1f2937",
      inputBg: "#ffffff",
      inputBorder: "#d1d5db",
      inputText: "#1f2937",
      shadow: "0 8px 32px rgba(0,0,0,0.12)",
    },
    dark: {
      bubbleBg: config.primaryColor,
      bubbleIcon: "#ffffff",
      chatBg: "#1f2937",
      chatBorder: "#374151",
      headerBg: "#111827",
      headerText: "#ffffff",
      messageUserBg: config.primaryColor,
      messageUserText: "#ffffff",
      messageBotBg: "#374151",
      messageBotText: "#f3f4f6",
      inputBg: "#374151",
      inputBorder: "#4b5563",
      inputText: "#f3f4f6",
      shadow: "0 8px 32px rgba(0,0,0,0.3)",
    },
  };

  var theme = themes[config.theme] || themes.light;

  // ============================
  // 3. Check Mobile
  // ============================
  var isMobile = window.innerWidth < 640;
  if (config.hideOnMobile && isMobile) return;

  // ============================
  // 4. Create Styles
  // ============================
  var styleId = "jasim-widget-styles";
  if (!document.getElementById(styleId)) {
    var styleEl = document.createElement("style");
    styleEl.id = styleId;
    styleEl.textContent = [
      /* Bubble */
      "#jasim-bubble-container {",
      "  position: fixed;",
      "  z-index: 9999;",
      "  cursor: pointer;",
      "  transition: transform 0.2s, box-shadow 0.2s;",
      "  user-select: none;",
      "  -webkit-user-select: none;",
      "}",
      "#jasim-bubble-container:hover {",
      "  transform: scale(1.05);",
      "  box-shadow: 0 6px 24px rgba(0,0,0,0.2);",
      "}",
      "#jasim-bubble-container.jasim-dragging {",
      "  transition: none;",
      "  cursor: grabbing;",
      "}",
      "#jasim-bubble-icon {",
      "  display: flex;",
      "  align-items: center;",
      "  justify-content: center;",
      "}",
      "#jasim-bubble-badge {",
      "  position: absolute;",
      "  top: -4px;",
      "  right: -4px;",
      "  background: #ef4444;",
      "  color: #fff;",
      "  font-size: 11px;",
      "  font-weight: 700;",
      "  border-radius: 50%;",
      "  width: 20px;",
      "  height: 20px;",
      "  display: flex;",
      "  align-items: center;",
      "  justify-content: center;",
      "  pointer-events: none;",
      "  display: none;",
      "}",
      "#jasim-bubble-badge.jasim-visible { display: flex; }",

      /* Chat Window */
      "#jasim-chat-container {",
      "  position: fixed;",
      "  z-index: 9998;",
      "  display: none;",
      "  flex-direction: column;",
      "  border-radius: 16px;",
      "  overflow: hidden;",
      "  font-family: 'Segoe UI', Tahoma, Arial, sans-serif;",
      "  transition: opacity 0.3s, transform 0.3s;",
      "  opacity: 0;",
      "  transform: translateY(20px) scale(0.95);",
      "}",
      "#jasim-chat-container.jasim-open {",
      "  display: flex;",
      "  opacity: 1;",
      "  transform: translateY(0) scale(1);",
      "}",
      "#jasim-chat-header {",
      "  display: flex;",
      "  align-items: center;",
      "  justify-content: space-between;",
      "  padding: 12px 16px;",
      "  cursor: default;",
      "  flex-shrink: 0;",
      "}",
      "#jasim-chat-close {",
      "  background: none;",
      "  border: none;",
      "  color: inherit;",
      "  cursor: pointer;",
      "  padding: 4px;",
      "  border-radius: 50%;",
      "  display: flex;",
      "  align-items: center;",
      "  justify-content: center;",
      "  opacity: 0.8;",
      "  transition: opacity 0.2s;",
      "}",
      "#jasim-chat-close:hover { opacity: 1; background: rgba(255,255,255,0.15); }",
      "#jasim-chat-messages {",
      "  flex: 1;",
      "  overflow-y: auto;",
      "  padding: 16px;",
      "  display: flex;",
      "  flex-direction: column;",
      "  gap: 8px;",
      "}",
      ".jasim-message {",
      "  max-width: 80%;",
      "  padding: 10px 14px;",
      "  border-radius: 14px;",
      "  font-size: 14px;",
      "  line-height: 1.5;",
      "  word-wrap: break-word;",
      "  animation: jasim-msg-in 0.25s ease-out;",
      "}",
      "@keyframes jasim-msg-in {",
      "  from { opacity: 0; transform: translateY(8px); }",
      "  to   { opacity: 1; transform: translateY(0); }",
      "}",
      ".jasim-message-user {",
      "  align-self: flex-start;",
      "  border-bottom-left-radius: 4px;",
      "}",
      ".jasim-message-bot {",
      "  align-self: flex-end;",
      "  border-bottom-right-radius: 4px;",
      "}",
      "#jasim-chat-input-area {",
      "  display: flex;",
      "  align-items: center;",
      "  gap: 8px;",
      "  padding: 12px 16px;",
      "  border-top: 1px solid " + theme.chatBorder + ";",
      "  flex-shrink: 0;",
      "}",
      "#jasim-chat-input {",
      "  flex: 1;",
      "  border: 1px solid " + theme.inputBorder + ";",
      "  border-radius: 24px;",
      "  padding: 10px 16px;",
      "  font-size: 14px;",
      "  outline: none;",
      "  background: " + theme.inputBg + ";",
      "  color: " + theme.inputText + ";",
      "  font-family: inherit;",
      "  transition: border-color 0.2s;",
      "}",
      "#jasim-chat-input:focus {",
      "  border-color: " + config.primaryColor + ";",
      "}",
      "#jasim-chat-send {",
      "  background: " + config.primaryColor + ";",
      "  color: #fff;",
      "  border: none;",
      "  border-radius: 50%;",
      "  width: 38px;",
      "  height: 38px;",
      "  display: flex;",
      "  align-items: center;",
      "  justify-content: center;",
      "  cursor: pointer;",
      "  flex-shrink: 0;",
      "  transition: opacity 0.2s;",
      "}",
      "#jasim-chat-send:hover { opacity: 0.9; }",
      "#jasim-chat-send:disabled { opacity: 0.5; cursor: not-allowed; }",

      /* Typing indicator */
      ".jasim-typing {",
      "  display: flex;",
      "  gap: 4px;",
      "  padding: 10px 14px;",
      "  border-radius: 14px;",
      "  align-self: flex-end;",
      "  border-bottom-right-radius: 4px;",
      "}",
      ".jasim-typing-dot {",
      "  width: 6px;",
      "  height: 6px;",
      "  border-radius: 50%;",
      "  background: " + theme.messageBotText + ";",
      "  opacity: 0.4;",
      "  animation: jasim-typing 1.4s infinite ease-in-out both;",
      "}",
      ".jasim-typing-dot:nth-child(1) { animation-delay: -0.32s; }",
      ".jasim-typing-dot:nth-child(2) { animation-delay: -0.16s; }",
      "@keyframes jasim-typing {",
      "  0%, 80%, 100% { transform: scale(0.6); }",
      "  40% { transform: scale(1); }",
      "}",

      /* Mobile */
      "@media (max-width: 639px) {",
      "  #jasim-chat-container {",
      "    width: 100vw !important;",
      "    height: 100vh !important;",
      "    max-height: 100vh !important;",
      "    bottom: 0 !important;",
      "    right: 0 !important;",
      "    left: 0 !important;",
      "    top: 0 !important;",
      "    border-radius: 0 !important;",
      "  }",
      "  #jasim-bubble-container { display: none !important; }",
      "}",
    ].join("\n");
    document.head.appendChild(styleEl);
  }

  // ============================
  // 5. Create Bubble Element
  // ============================
  var bubbleContainer = document.createElement("div");
  bubbleContainer.id = "jasim-bubble-container";

  // Position
  var positions = {
    "bottom-right": { bottom: "20px", right: "20px", left: "auto", top: "auto" },
    "bottom-left": { bottom: "20px", left: "20px", right: "auto", top: "auto" },
    "top-right": { top: "20px", right: "20px", bottom: "auto", left: "auto" },
    "top-left": { top: "20px", left: "20px", bottom: "auto", right: "auto" },
  };
  var pos = positions[config.position] || positions["bottom-right"];
  Object.keys(pos).forEach(function (key) {
    bubbleContainer.style[key] = pos[key];
  });

  var bubbleSize = config.bubbleSize;
  var borderRadius = config.bubbleStyle === "square" ? "12px" : config.bubbleStyle === "rounded" ? "16px" : "50%";

  bubbleContainer.style.width = bubbleSize + "px";
  bubbleContainer.style.height = bubbleSize + "px";
  bubbleContainer.style.background = theme.bubbleBg;
  bubbleContainer.style.borderRadius = borderRadius;
  bubbleContainer.style.boxShadow = "0 4px 16px rgba(0,0,0,0.15)";
  bubbleContainer.style.display = "flex";
  bubbleContainer.style.alignItems = "center";
  bubbleContainer.style.justifyContent = "center";

  // Bubble icon (chat SVG)
  var chatIconSvg =
    '<svg id="jasim-bubble-icon" width="' + (bubbleSize * 0.45) + '" height="' + (bubbleSize * 0.45) + '" viewBox="0 0 24 24" fill="none" stroke="' + theme.bubbleIcon + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' +
    "</svg>";

  bubbleContainer.innerHTML = chatIconSvg +
    '<span id="jasim-bubble-badge">0</span>';

  // Use user's container if exists, else append to body
  var userContainer = document.getElementById("jasim-bubble");
  if (userContainer) {
    userContainer.appendChild(bubbleContainer);
  } else {
    document.body.appendChild(bubbleContainer);
  }

  // ============================
  // 6. Create Chat Container
  // ============================
  var chatContainer = document.createElement("div");
  chatContainer.id = "jasim-chat-container";
  chatContainer.style.background = theme.chatBg;
  chatContainer.style.boxShadow = theme.shadow;
  chatContainer.style.border = "1px solid " + theme.chatBorder;
  chatContainer.dir = config.dir;

  if (isMobile) {
    chatContainer.style.width = "100vw";
    chatContainer.style.height = "100vh";
  } else {
    chatContainer.style.width = config.chatWidth + "px";
    chatContainer.style.height = config.chatHeight + "px";
    var chatPositions = {
      "bottom-right": { bottom: "100px", right: "20px" },
      "bottom-left": { bottom: "100px", left: "20px" },
      "top-right": { top: "100px", right: "20px" },
      "top-left": { top: "100px", left: "20px" },
    };
    var chatPos = chatPositions[config.position] || chatPositions["bottom-right"];
    Object.keys(chatPos).forEach(function (key) {
      chatContainer.style[key] = chatPos[key];
    });
  }

  chatContainer.style.maxHeight = "calc(100vh - 140px)";
  chatContainer.style.borderRadius = isMobile ? "0" : "16px";

  document.body.appendChild(chatContainer);

  // Header
  var header = document.createElement("div");
  header.id = "jasim-chat-header";
  header.style.background = theme.headerBg;
  header.style.color = theme.headerText;

  var headerTitle = document.createElement("div");
  headerTitle.style.display = "flex";
  headerTitle.style.alignItems = "center";
  headerTitle.style.gap = "10px";
  headerTitle.innerHTML =
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
    '<path d="M12 2a10 10 0 0 1 10 10c0 5.523-4.477 10-10 10S2 17.523 2 12 6.477 2 12 2z"/>' +
    '<path d="M8 14s1.5 2 4 2 4-2 4-2"/>' +
    '<line x1="9" y1="9" x2="9.01" y2="9"/>' +
    '<line x1="15" y1="9" x2="15.01" y2="9"/>' +
    "</svg>" +
    "<span style=\"font-weight:600;font-size:15px;\">مساعد جاسم</span>";

  var closeBtn = document.createElement("button");
  closeBtn.id = "jasim-chat-close";
  closeBtn.innerHTML =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
    '<line x1="18" y1="6" x2="6" y2="18"/>' +
    '<line x1="6" y1="6" x2="18" y2="18"/>' +
    "</svg>";

  header.appendChild(headerTitle);
  header.appendChild(closeBtn);

  // Messages area
  var messagesArea = document.createElement("div");
  messagesArea.id = "jasim-chat-messages";

  // Input area
  var inputArea = document.createElement("div");
  inputArea.id = "jasim-chat-input-area";
  inputArea.style.background = theme.chatBg;

  var textInput = document.createElement("input");
  textInput.id = "jasim-chat-input";
  textInput.type = "text";
  textInput.placeholder = config.placeholder;
  textInput.setAttribute("autocomplete", "off");

  var sendBtn = document.createElement("button");
  sendBtn.id = "jasim-chat-send";
  sendBtn.innerHTML =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
    '<line x1="22" y1="2" x2="11" y2="13"/>' +
    '<polygon points="22 2 15 22 11 13 2 9 22 2"/>' +
    "</svg>";

  inputArea.appendChild(textInput);
  inputArea.appendChild(sendBtn);

  chatContainer.appendChild(header);
  chatContainer.appendChild(messagesArea);
  chatContainer.appendChild(inputArea);

  // ============================
  // 7. Chat State & Functions
  // ============================
  var isOpen = false;
  var messages = [];
  var unreadCount = 0;
  var sessionId = "js_" + Date.now() + "_" + Math.random().toString(36).slice(2, 10);
  var ws = null;

  function log() {
    if (config.debug) {
      console.log.apply(console, ["[JASIM]"].concat(Array.prototype.slice.call(arguments)));
    }
  }

  function addMessage(text, sender) {
    var msgDiv = document.createElement("div");
    msgDiv.className = "jasim-message jasim-message-" + sender;
    msgDiv.style.background = sender === "user" ? theme.messageUserBg : theme.messageBotBg;
    msgDiv.style.color = sender === "user" ? theme.messageUserText : theme.messageBotText;
    msgDiv.textContent = text;
    messagesArea.appendChild(msgDiv);
    messagesArea.scrollTop = messagesArea.scrollHeight;
    messages.push({ text: text, sender: sender, time: Date.now() });
  }

  function showTyping() {
    var existing = document.querySelector(".jasim-typing");
    if (existing) return;

    var typing = document.createElement("div");
    typing.className = "jasim-typing jasim-message-bot";
    typing.style.background = theme.messageBotBg;
    typing.innerHTML =
      '<span class="jasim-typing-dot"></span>' +
      '<span class="jasim-typing-dot"></span>' +
      '<span class="jasim-typing-dot"></span>';
    messagesArea.appendChild(typing);
    messagesArea.scrollTop = messagesArea.scrollHeight;
    return typing;
  }

  function hideTyping() {
    var typing = document.querySelector(".jasim-typing");
    if (typing) typing.remove();
  }

  function openChat() {
    isOpen = true;
    chatContainer.classList.add("jasim-open");
    bubbleContainer.style.display = "none";
    unreadCount = 0;
    updateBadge();

    // Greeting on first open
    if (messages.length === 0) {
      addMessage(config.greeting, "bot");
    }

    textInput.focus();

    // Track event
    trackEvent("chat_opened");

    log("Chat opened");
  }

  function closeChat() {
    isOpen = false;
    chatContainer.classList.remove("jasim-open");
    bubbleContainer.style.display = "flex";
    log("Chat closed");
  }

  function updateBadge() {
    var badge = document.getElementById("jasim-bubble-badge");
    if (!badge) return;
    badge.textContent = unreadCount > 9 ? "9+" : String(unreadCount);
    if (unreadCount > 0) {
      badge.classList.add("jasim-visible");
    } else {
      badge.classList.remove("jasim-visible");
    }
  }

  function sendMessage() {
    var text = textInput.value.trim();
    if (!text) return;

    addMessage(text, "user");
    textInput.value = "";
    textInput.focus();

    showTyping();
    trackEvent("message_sent", { messageLength: text.length });

    // Simulate bot response (in production, this would call the API)
    setTimeout(function () {
      hideTyping();

      var responses = [
        "شكراً لتواصلك معنا! سأقوم بمساعدتك في أقرب وقت.",
        "يمكنني مساعدتك في البحث عن المنتجات أو تتبع طلباتك.",
        "هل تحتاج مساعدة في شيء آخر؟",
        "تم استلام رسالتك، أحد ممثلي خدمة العملاء سيتواصل معك قريباً.",
      ];
      var response = responses[Math.floor(Math.random() * responses.length)];
      addMessage(response, "bot");

      if (!isOpen) {
        unreadCount++;
        updateBadge();
      }
    }, 1500 + Math.random() * 1500);
  }

  function trackEvent(eventType, metadata) {
    try {
      var payload = {
        embedToken: config.apiKey,
        eventType: eventType,
        sessionId: sessionId,
        url: window.location.href,
        metadata: metadata || {},
      };

      // Try beacon API first
      if (navigator.sendBeacon) {
        navigator.sendBeacon(
          "https://" + config.host + "/api/trpc/widget.trackEvent",
          JSON.stringify({ json: payload })
        );
      } else {
        // Fallback to fetch
        fetch("https://" + config.host + "/api/trpc/widget.trackEvent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ json: payload }),
          keepalive: true,
        }).catch(function () {});
      }
    } catch (e) {
      log("Track error:", e);
    }
  }

  // ============================
  // 8. Event Listeners
  // ============================
  bubbleContainer.addEventListener("click", function () {
    openChat();
  });

  closeBtn.addEventListener("click", function () {
    closeChat();
  });

  sendBtn.addEventListener("click", sendMessage);

  textInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      sendMessage();
    }
  });

  // Drag support
  var isDragging = false;
  var dragOffset = { x: 0, y: 0 };
  var startPos = { x: 0, y: 0 };

  bubbleContainer.addEventListener("mousedown", function (e) {
    isDragging = true;
    startPos.x = e.clientX;
    startPos.y = e.clientY;
    var rect = bubbleContainer.getBoundingClientRect();
    dragOffset.x = e.clientX - rect.left;
    dragOffset.y = e.clientY - rect.top;
    bubbleContainer.classList.add("jasim-dragging");
  });

  document.addEventListener("mousemove", function (e) {
    if (!isDragging) return;
    var x = e.clientX - dragOffset.x;
    var y = e.clientY - dragOffset.y;
    bubbleContainer.style.left = x + "px";
    bubbleContainer.style.top = y + "px";
    bubbleContainer.style.right = "auto";
    bubbleContainer.style.bottom = "auto";
  });

  document.addEventListener("mouseup", function () {
    if (isDragging) {
      isDragging = false;
      bubbleContainer.classList.remove("jasim-dragging");
    }
  });

  // PostMessage listener (for iframe integration)
  window.addEventListener("message", function (event) {
    if (event.data && event.data.type === "JASIM_WIDGET") {
      var data = event.data;
      if (data.action === "open") openChat();
      if (data.action === "close") closeChat();
      if (data.action === "setTheme" && data.theme) {
        theme = themes[data.theme] || theme;
      }
    }
  });

  // Keyboard shortcut (Escape to close)
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && isOpen) {
      closeChat();
    }
  });

  // ============================
  // 9. Auto Open
  // ============================
  if (config.autoOpen) {
    setTimeout(function () {
      if (!isOpen) openChat();
    }, config.autoOpenDelay);
  }

  // ============================
  // 10. Track Impression
  // ============================
  trackEvent("impression");

  // Log initialization
  log("Widget initialized", {
    sessionId: sessionId,
    theme: config.theme,
    position: config.position,
  });

  // Expose API
  window.JasimWidget = {
    open: openChat,
    close: closeChat,
    toggle: function () { isOpen ? closeChat() : openChat(); },
    sendMessage: function (text) { addMessage(text, "user"); },
    config: config,
    sessionId: sessionId,
  };
})();

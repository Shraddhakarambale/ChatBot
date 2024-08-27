document.addEventListener('DOMContentLoaded', function () {
    const chatBox = document.getElementById('chatBox');
    const chatForm = document.getElementById('chatForm');
    const userInput = document.getElementById('userInput');
    const submitButton = document.getElementById('submitButton');
    const newChatBtn = document.getElementById('newChatBtn');
    const chatList = document.getElementById('chatList');
    const renameChatModal = $('#renameChatModal');
    const removeChatModal = $('#removeChatModal');

    let currentChatId = null;
    let isProcessing = false;

    newChatBtn.addEventListener('click', handleNewChatClick);
    chatList.addEventListener('click', handleChatListClick);
    chatForm.addEventListener('submit', handleChatSubmit);

    async function handleNewChatClick(e) {
        e.preventDefault();
        if (isProcessing) return;
        isProcessing = true;
        try {
            await createNewChat();
        } finally {
            isProcessing = false;
        }
    }

    async function createNewChat() {
        const response = await fetch('/Home/NewChat', { method: 'POST' });
        const data = await response.json();
        const newChatId = data.chatId;
        addChatToList(newChatId, data.name);
        selectChat(newChatId);
        return newChatId;
    }

    function handleChatListClick(e) {
        const target = e.target;
        const chatItem = target.closest('.chat-item');

        if (chatItem) {
            if (target.closest('.rename-chat')) {
                showRenameChatModal(chatItem);
            } else if (target.closest('.remove-chat')) {
                showRemoveChatModal(chatItem);
            } else {
                const chatId = chatItem.getAttribute('data-chat-id');
                selectChat(chatId);
            }
        }
    }

    function selectChat(chatId) {
        currentChatId = chatId;
        document.querySelectorAll('.chat-item').forEach(item => {
            item.classList.remove('active');
            if (item.getAttribute('data-chat-id') === chatId) {
                item.classList.add('active');
            }
        });
        loadChatHistory(chatId);
    }

    async function handleChatSubmit(e) {
        e.preventDefault();
        if (isProcessing) return;

        const message = userInput.value.trim();
        if (!message) return;

        isProcessing = true;
        try {
            if (!currentChatId) {
                currentChatId = await createNewChat();
            }
            await sendMessage(message);
        } finally {
            isProcessing = false;
        }
    }

    async function sendMessage(message) {
        appendMessage('You', message);
        disableForm();
        await getStreamingResponse(message, currentChatId);
        enableForm();
    }

    function showRenameChatModal(chatItem) {
        const chatId = chatItem.getAttribute('data-chat-id');
        const chatName = chatItem.querySelector('.chat-name').textContent;
        $('#newChatName').val(chatName);
        $('#confirmRename').off('click').on('click', () => renameChat(chatId, chatItem));
        renameChatModal.modal('show');
    }

    function showRemoveChatModal(chatItem) {
        const chatId = chatItem.getAttribute('data-chat-id');
        $('#confirmRemove').off('click').on('click', () => removeChat(chatId, chatItem));
        removeChatModal.modal('show');
    }

    async function renameChat(chatId, chatItem) {
        const newName = $('#newChatName').val().trim();
        if (newName) {
            const response = await fetch('/Home/RenameChat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `chatId=${encodeURIComponent(chatId)}&newName=${encodeURIComponent(newName)}`
            });
            if (response.ok) {
                chatItem.querySelector('.chat-name').textContent = newName;
                renameChatModal.modal('hide');
            }
        }
    }

    async function removeChat(chatId, chatItem) {
        const response = await fetch('/Home/RemoveChat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `chatId=${encodeURIComponent(chatId)}`
        });
        if (response.ok) {
            chatItem.remove();
            if (currentChatId === chatId) {
                currentChatId = null;
                chatBox.innerHTML = '';
            }
            removeChatModal.modal('hide');
        }
    }

    function addChatToList(chatId, name) {
        const listItem = document.createElement('li');
        listItem.className = 'list-group-item chat-item d-flex justify-content-between align-items-center';
        listItem.setAttribute('data-chat-id', chatId);
        listItem.innerHTML = `
            <span class="chat-name">${name}</span>
            <div class="btn-group">
                <button class="btn btn-sm btn-outline-primary rename-chat" data-chat-id="${chatId}">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn btn-sm btn-outline-danger remove-chat" data-chat-id="${chatId}">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `;
        chatList.appendChild(listItem);
    }

    async function loadChatHistory(chatId) {
        chatBox.innerHTML = '';
        const response = await fetch(`/Home/GetChatHistory?chatId=${chatId}`);
        if (response.ok) {
            const data = await response.json();
            data.messages.forEach(msg => appendMessage(msg.role === 'user' ? 'You' : 'Bot', msg.content));
        } else {
            console.error('Failed to load chat history');
        }
    }

    function appendMessage(sender, message) {
        const messageElement = document.createElement('div');
        messageElement.innerHTML = `<strong>${sender}:</strong> ${message}`;
        chatBox.appendChild(messageElement);
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    function disableForm() {
        userInput.disabled = true;
        submitButton.disabled = true;
        submitButton.innerHTML = 'Waiting...';
    }

    function enableForm() {
        userInput.disabled = false;
        submitButton.disabled = false;
        submitButton.innerHTML = 'Send';
        userInput.value = '';
        userInput.focus();
    }

    async function getStreamingResponse(message, chatId) {
        try {
            const botResponseElement = document.createElement('div');
            botResponseElement.innerHTML = '<strong>Bot:</strong> <span class="typing-indicator">Thinking...</span>';
            chatBox.appendChild(botResponseElement);
            chatBox.scrollTop = chatBox.scrollHeight;

            const response = await fetch('/Home/StreamResponse', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: `message=${encodeURIComponent(message)}&chatId=${encodeURIComponent(chatId)}`,
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            let isFirstChunk = true;
            let responseText = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value);
                const lines = chunk.split('\n');

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') {
                            break;
                        }
                        if (data.startsWith('Error:')) {
                            botResponseElement.innerHTML = `<strong>Bot:</strong> <span style="color: red;">${data}</span>`;
                        } else {
                            if (isFirstChunk) {
                                botResponseElement.innerHTML = '<strong>Bot:</strong> ';
                                isFirstChunk = false;
                            }
                            responseText += data;
                            botResponseElement.innerHTML = `<strong>Bot:</strong> ${responseText}`;
                        }
                        chatBox.scrollTop = chatBox.scrollHeight;
                    }
                }
            }
        } catch (error) {
            console.error('Error:', error);
            appendMessage('System', 'An error occurred while fetching the response.');
        }
    }
});

// Add this CSS to improve the active chat styling
document.head.insertAdjacentHTML('beforeend', `
<style>
    .chat-item {
        transition: all 0.3s ease;
        border: 1px solid #dee2e6;
        border-radius: 0.25rem;
        margin-bottom: 0.5rem;
        overflow: hidden;
    }
    .chat-item:hover {
        background-color: #f8f9fa;
    }
    .chat-item.active {
        background-color: #e3f2fd;
        border-left: 4px solid #2196f3;
        box-shadow: 0 2px 5px rgba(0,0,0,0.1);
    }
    .chat-item .chat-name {
        font-weight: 500;
        color: #333;
        padding: 0.5rem 0.75rem;
    }
    .chat-item.active .chat-name {
        color: #0d6efd;
    }
    .chat-item .btn-group {
        opacity: 0.7;
        transition: opacity 0.3s ease;
        margin-right: 0.25rem;
    }
    .chat-item:hover .btn-group {
        opacity: 1;
    }
    .chat-item .btn {
        padding: 0.25rem 0.5rem;
    }
    .chat-item .btn i {
        font-size: 0.875rem;
    }
    .list-group-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.5rem 0.25rem 0.5rem 0.75rem;
    }
</style>
`);
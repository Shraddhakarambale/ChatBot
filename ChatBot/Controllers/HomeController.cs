using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Text;
using System.Text.Json;
using ChatBot.Data;
using ChatBot.Models;
using Microsoft.Extensions.Configuration;

namespace ChatBot.Controllers
{
    public class HomeController : Controller
    {
        private readonly ILogger<HomeController> _logger;
        private readonly ChatDbContext _context;
        private readonly HttpClient _httpClient;
        private readonly string _apiEndpoint;
        private readonly string _apiKey;

        public HomeController(ILogger<HomeController> logger, ChatDbContext context, IHttpClientFactory httpClientFactory, IConfiguration configuration)
        {
            _logger = logger;
            _context = context;
            _httpClient = httpClientFactory.CreateClient();

            _apiEndpoint = configuration["OpenAI:ApiEndpoint"] ?? throw new ArgumentNullException(nameof(configuration), "OpenAI:ApiEndpoint is not configured");
            _apiKey = configuration["OpenAI:ApiKey"] ?? throw new ArgumentNullException(nameof(configuration), "OpenAI:ApiKey is not configured");

            _httpClient.DefaultRequestHeaders.Add("api-key", _apiKey);
        }

        public async Task<IActionResult> Index()
        {
            var chats = await _context.Chats.Select(c => new ChatViewModel { Id = c.Id, Name = c.Name }).ToListAsync();
            return View(chats);
        }

        [HttpPost]
        public async Task StreamResponse(string message, string chatId)
        {
            Response.Headers.Append("Content-Type", "text/event-stream");

            var chat = await _context.Chats.Include(c => c.Messages).FirstOrDefaultAsync(c => c.Id == chatId);
            if (chat == null)
            {
                chat = new Chat { Id = chatId, Name = $"Chat {chatId.Substring(0, 8)}", Messages = new List<Message>() };
                _context.Chats.Add(chat);
            }

            chat.Messages.Add(new Message { ChatId = chatId, Role = "user", Content = message, Timestamp = DateTime.UtcNow });
            await _context.SaveChangesAsync();

            // Log the user message
            await LogChatAction(chatId, "UserMessage", message);

            try
            {
                var requestBody = new
                {
                    messages = chat.Messages.Select(m => new { role = m.Role, content = m.Content }).ToArray(),
                    max_tokens = 800,
                    temperature = 0.7,
                    frequency_penalty = 0,
                    presence_penalty = 0,
                    top_p = 0.95,
                    stop = null as string[],
                    stream = true
                };

                var requestContent = new StringContent(JsonSerializer.Serialize(requestBody), Encoding.UTF8, "application/json");
                var response = await _httpClient.PostAsync(_apiEndpoint, requestContent);

                if (response.IsSuccessStatusCode)
                {
                    using var responseStream = await response.Content.ReadAsStreamAsync();
                    using var reader = new StreamReader(responseStream);

                    var fullResponse = "";

                    while (!reader.EndOfStream)
                    {
                        var line = await reader.ReadLineAsync();
                        if (line != null && line.StartsWith("data: "))
                        {
                            var data = line.Substring(6);
                            if (data == "[DONE]")
                            {
                                await Response.WriteAsync($"data: [DONE]\n\n");
                                break;
                            }

                            try
                            {
                                var jsonElement = JsonSerializer.Deserialize<JsonElement>(data);
                                if (jsonElement.TryGetProperty("choices", out var choices) &&
                                    choices[0].TryGetProperty("delta", out var delta) &&
                                    delta.TryGetProperty("content", out var content))
                                {
                                    var contentDelta = content.GetString();
                                    if (!string.IsNullOrEmpty(contentDelta))
                                    {
                                        fullResponse += contentDelta;
                                        await Response.WriteAsync($"data: {contentDelta}\n\n");
                                        await Response.Body.FlushAsync();
                                    }
                                }
                            }
                            catch (JsonException ex)
                            {
                                _logger.LogError(ex, "Error parsing JSON response");
                                await Response.WriteAsync($"data: Error parsing response\n\n");
                            }
                        }
                    }

                    chat.Messages.Add(new Message { ChatId = chatId, Role = "assistant", Content = fullResponse, Timestamp = DateTime.UtcNow });
                    await _context.SaveChangesAsync();

                    // Log the assistant's message
                    await LogChatAction(chatId, "AssistantMessage", fullResponse);
                }
                else
                {
                    _logger.LogError($"API request failed with status code: {response.StatusCode}");
                    await Response.WriteAsync($"data: Error: API request failed with status code {response.StatusCode}\n\n");
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "An error occurred while processing the request");
                await Response.WriteAsync($"data: Error: An unexpected error occurred. Please try again later.\n\n");
            }
        }

        [HttpGet]
        public async Task<IActionResult> GetChatHistory(string chatId)
        {
            var chat = await _context.Chats.Include(c => c.Messages).FirstOrDefaultAsync(c => c.Id == chatId);
            if (chat != null)
            {
                return Json(new { name = chat.Name, messages = chat.Messages });
            }
            return NotFound();
        }

        [HttpPost]
        public async Task<IActionResult> NewChat()
        {
            var chatId = Guid.NewGuid().ToString();
            var chat = new Chat { Id = chatId, Name = $"Chat {chatId.Substring(0, 8)}", Messages = new List<Message>() };
            _context.Chats.Add(chat);
            await _context.SaveChangesAsync();

            // Log the new chat creation
            await LogChatAction(chatId, "ChatCreated", "New chat created");

            return Json(new { chatId, name = chat.Name });
        }

        [HttpPost]
        public async Task<IActionResult> RenameChat(string chatId, string newName)
        {
            var chat = await _context.Chats.FindAsync(chatId);
            if (chat != null)
            {
                chat.Name = newName;
                await _context.SaveChangesAsync();

                // Log the chat rename action
                await LogChatAction(chatId, "ChatRenamed", $"Chat renamed to: {newName}");

                return Json(new { success = true });
            }
            return NotFound();
        }

        [HttpPost]
        public async Task<IActionResult> RemoveChat(string chatId)
        {
            var chat = await _context.Chats.FindAsync(chatId);
            if (chat != null)
            {
                _context.Chats.Remove(chat);
                await _context.SaveChangesAsync();

                // Log the chat removal action
                await LogChatAction(chatId, "ChatRemoved", "Chat removed");

                return Json(new { success = true });
            }
            return NotFound();
        }

        private async Task LogChatAction(string chatId, string action, string content)
        {
            var log = new ChatLog
            {
                ChatId = chatId,
                Action = action,
                Content = content,
                Timestamp = DateTime.UtcNow
            };
            _context.ChatLogs.Add(log);
            await _context.SaveChangesAsync();
        }
    }
}
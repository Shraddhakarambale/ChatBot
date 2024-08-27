using Microsoft.EntityFrameworkCore;
using ChatBot.Models;

namespace ChatBot.Data
{
    public class ChatDbContext : DbContext
    {
        public ChatDbContext(DbContextOptions<ChatDbContext> options) : base(options) { }

        public DbSet<Chat> Chats { get; set; }
        public DbSet<Message> Messages { get; set; }
        public DbSet<ChatLog> ChatLogs { get; set; }
    }
}
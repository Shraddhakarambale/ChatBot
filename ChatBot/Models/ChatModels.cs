using System;
using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;

namespace ChatBot.Models
{
    public class Chat
    {
        [Key]
        public string Id { get; set; }
        public string Name { get; set; }
        public List<Message> Messages { get; set; }
    }

    public class Message
    {
        [Key]
        public int Id { get; set; }
        public string ChatId { get; set; }
        public string Role { get; set; }
        public string Content { get; set; }
        public DateTime Timestamp { get; set; }
    }

    public class ChatLog
    {
        [Key]
        public int Id { get; set; }
        public string ChatId { get; set; }
        public string Action { get; set; }
        public string Content { get; set; }
        public DateTime Timestamp { get; set; }
    }
}
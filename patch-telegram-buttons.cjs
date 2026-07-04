const fs = require('fs');

let tg = fs.readFileSync('src/gateway/Telegram.ts', 'utf8');

// The Telegram send method currently just sends text.
// We need it to support inline_keyboard when the agent sends an "options" payload.
// Let's modify the signature of send to accept options, which is already in Platform interface.

const target = `  async send(content: string, channelId: string, replyTo?: string): Promise<void> {`;
const inject = `  async send(content: string, channelId: string, replyTo?: string, options?: any): Promise<void> {`;
tg = tg.replace(target, inject);

const targetSend = `      await this.bot.sendMessage(channelId, text, {
        parse_mode: 'Markdown',
        reply_parameters: replyTo ? { message_id: parseInt(replyTo) } : undefined,
        disable_web_page_preview: true,
      });`;

const injectSend = `      const sendOpts: any = {
        parse_mode: 'Markdown',
        reply_parameters: replyTo ? { message_id: parseInt(replyTo) } : undefined,
        disable_web_page_preview: true,
      };
      
      // Inject Telegram Inline Keyboard if provided
      if (options?.reply_markup) {
        sendOpts.reply_markup = options.reply_markup;
      }
      
      await this.bot.sendMessage(channelId, text, sendOpts);`;
tg = tg.replace(targetSend, injectSend);


// Also handle callback_queries for when the user clicks the button!
const targetConstruct = `  async connect(): Promise<void> {
    if (this.bot) return;`;

const injectConstruct = `  async connect(): Promise<void> {
    if (this.bot) return;

    this.bot = new TelegramBot(this.token, { polling: true });
    
    // Handle inline button clicks
    this.bot.on('callback_query', async (query) => {
      if (!query.message || !query.data) return;
      const channelId = query.message.chat.id.toString();
      const authorId = query.from.id.toString();
      const authorName = query.from.username || query.from.first_name || 'User';
      
      // We answer the callback to remove the loading state on the button
      try { await this.bot!.answerCallbackQuery(query.id); } catch {}
      
      this.emit('message', {
        platform: 'telegram',
        authorId,
        authorName,
        channelId,
        content: query.data, // The text value from the button
        replyTo: query.message.message_id.toString(),
      });
    });
`;

if (!tg.includes("callback_query")) {
  tg = tg.replace(targetConstruct, injectConstruct);
}

fs.writeFileSync('src/gateway/Telegram.ts', tg);
console.log('Telegram.ts patched to support Inline Keyboards');

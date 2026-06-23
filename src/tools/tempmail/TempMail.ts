import { fetch } from 'undici';

export class TempMail {
  private address: string = '';
  private token: string = '';
  private password: string = 'aurix_temp_pass_123';

  /**
   * Initializes a new temporary email account
   * @returns The generated email address
   */
  public async initialize(): Promise<string> {
    try {
      // 1. Get available domain
      const domainsRes = await fetch('https://api.mail.tm/domains');
      if (!domainsRes.ok) throw new Error(`Failed to fetch domains: ${domainsRes.statusText}`);
      
      const domainsData = await domainsRes.json() as any;
      if (!domainsData['hydra:member'] || domainsData['hydra:member'].length === 0) {
        throw new Error('No domains available from mail.tm');
      }
      
      const domain = domainsData['hydra:member'][0].domain;
      this.address = `ax_${Date.now()}_${Math.floor(Math.random() * 1000)}@${domain}`;

      // 2. Create account
      const createRes = await fetch('https://api.mail.tm/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: this.address, password: this.password })
      });
      
      if (!createRes.ok) throw new Error(`Failed to create account: ${createRes.statusText}`);

      // 3. Get auth token
      const tokenRes = await fetch('https://api.mail.tm/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: this.address, password: this.password })
      });
      
      if (!tokenRes.ok) throw new Error(`Failed to get auth token: ${tokenRes.statusText}`);
      const tokenData = await tokenRes.json() as any;
      this.token = tokenData.token;

      return this.address;
    } catch (error: any) {
      throw new Error(`TempMail init failed: ${error.message}`);
    }
  }

  /**
   * Gets current email address
   */
  public getAddress(): string {
    if (!this.address) throw new Error("TempMail not initialized. Call initialize() first.");
    return this.address;
  }

  /**
   * Polls inbox for new messages and extracts OTP/links
   * @param timeoutSeconds Max time to wait in seconds
   * @param extractRegex Optional regex string to extract specific data from email text (e.g., OTP)
   * @returns The message text, or extracted match if regex provided
   */
  public async waitForEmail(timeoutSeconds: number = 60, extractRegex?: string): Promise<{subject: string, text: string, extracted?: string | null}> {
    if (!this.token) throw new Error("TempMail not initialized. Call initialize() first.");
    
    const startTime = Date.now();
    const timeoutMs = timeoutSeconds * 1000;
    const seenIds = new Set<string>();

    while (Date.now() - startTime < timeoutMs) {
      try {
        const inboxRes = await fetch('https://api.mail.tm/messages', {
          headers: { 'Authorization': `Bearer ${this.token}` }
        });
        
        if (inboxRes.ok) {
          const inboxData = await inboxRes.json() as any;
          const messages = inboxData['hydra:member'] || [];
          
          for (const msg of messages) {
            if (!seenIds.has(msg.id)) {
              seenIds.add(msg.id);
              
              // Fetch full message content
              const msgRes = await fetch(`https://api.mail.tm/messages/${msg.id}`, {
                headers: { 'Authorization': `Bearer ${this.token}` }
              });
              
              if (msgRes.ok) {
                const msgDetail = await msgRes.json() as any;
                const textContent = msgDetail.text || msgDetail.html || '';
                
                let extracted: string | null = null;
                if (extractRegex) {
                  const rx = new RegExp(extractRegex, 'i');
                  const match = textContent.match(rx);
                  extracted = match ? (match[1] || match[0]) : null;
                } else {
                  // Default auto-extraction for OTP (6 digits, or "code is XXXX")
                  const otpRx = /\b\d{4,8}\b/g;
                  const matches = textContent.match(otpRx);
                  if (matches) {
                    // Try to find the most likely OTP (ignore dates/years if possible)
                    extracted = matches.sort((a: string, b: string) => b.length - a.length)[0];
                  }
                }

                return {
                  subject: msgDetail.subject,
                  text: textContent.substring(0, 500) + (textContent.length > 500 ? '...' : ''), // truncate to avoid bloating LLM context
                  extracted: extracted || undefined
                };
              }
            }
          }
        }
      } catch (e) {
        // Ignore fetch errors during polling
      }
      
      // Wait 3 seconds before next poll
      await new Promise(r => setTimeout(r, 3000));
    }
    
    throw new Error(`Timeout: No email received after ${timeoutSeconds} seconds.`);
  }
}

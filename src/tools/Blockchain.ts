import type { Tool } from './Registry.js';

export const blockchainTools: Tool[] = [
  {
    name: 'evm_wallet',
    description: 'Query EVM blockchain wallet balance and transactions.',
    parameters: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Wallet address' },
        chain: { type: 'string', description: 'ethereum, polygon, bsc, arbitrum, base' },
        action: { type: 'string', description: 'balance, transactions, tokens' },
      },
      required: ['address'],
    },
    async execute(args) {
      const address = args.address as string;
      const chain = (args.chain as string) || 'ethereum';
      const action = (args.action as string) || 'balance';

      const rpcUrls: Record<string, string> = {
        ethereum: 'https://eth.llamarpc.com',
        polygon: 'https://polygon-rpc.com',
        bsc: 'https://bsc-dataseed.binance.org',
        arbitrum: 'https://arb1.arbitrum.io/rpc',
        base: 'https://mainnet.base.org',
      };

      const rpc = rpcUrls[chain] || rpcUrls.ethereum;

      if (action === 'balance') {
        try {
          const res = await fetch(rpc, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0', method: 'eth_getBalance',
              params: [address, 'latest'], id: 1,
            }),
          });
          const data = await res.json() as any;
          const wei = BigInt(data.result || '0x0');
          const eth = Number(wei) / 1e18;
          return `Wallet: ${address}\nChain: ${chain}\nBalance: ${eth.toFixed(6)} ETH`;
        } catch (e: any) {
          return `Error querying balance: ${e.message}`;
        }
      }

      return `Action "${action}" for ${address} on ${chain}. Use a block explorer for detailed info.`;
    },
  },
  {
    name: 'solana_wallet',
    description: 'Query Solana wallet balance and token holdings.',
    parameters: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Solana wallet address' },
        action: { type: 'string', description: 'balance or tokens' },
      },
      required: ['address'],
    },
    async execute(args) {
      const address = args.address as string;
      const action = (args.action as string) || 'balance';
      try {
        const res = await fetch('https://api.mainnet-beta.solana.com', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', method: 'getBalance',
            params: [address], id: 1,
          }),
        });
        const data = await res.json() as any;
        const lamports = data.result?.value || 0;
        const sol = lamports / 1e9;
        return `Wallet: ${address}\nBalance: ${sol.toFixed(6)} SOL`;
      } catch (e: any) {
        return `Error: ${e.message}`;
      }
    },
  },
];

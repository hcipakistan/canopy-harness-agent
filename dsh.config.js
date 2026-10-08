// dsh.config.js
require('dotenv').config();
const fs = require('fs');

// Load branch data
const branches = JSON.parse(fs.readFileSync('./config/branches.json', 'utf8'));

module.exports = {
  id: 'canopy-crm',

  // ─── SKILLS ──────────────────────────────────────────────
  
    skills: {
    directory: './skills',
  },

  // ─── BRANCH DATA (available to all skills) ─────────────
  context: {
    branches: branches.branches,
  },

  // ─── PLUGINS ──────────────────────────────────────────────
  plugins: [
    // DeepSeek LLM
    {
      id: 'llm-deepseek',
      name: '@deepseek-ai/dsh-llm-deepseek',
      config: {
        apiKeyEnv: 'DEEPSEEK_API_KEY',
        baseURL: 'https://api.deepseek.com/v1',
        defaultModel: 'deepseek-chat',
        enableCache: true,
      },
    },

    // WhatsApp IM
    {
      id: 'im',
      name: 'dsh-im',
      config: {
        channels: {
          whatsapp: {
            enabled: true,
            workspace: 'canopy-workspace',
          },
        },
      },
    },

    // HTTP Tool (Supabase)
    {
      id: 'tool-http',
      name: '@deepseek-ai/dsh-tool-http',
      config: {
        endpoints: {
          createPatient: {
            url: `${process.env.SUPABASE_URL}/rest/v1/patients`,
            method: 'POST',
            headers: {
              'apikey': process.env.SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=representation',
            },
          },
          updatePatient: {
            url: `${process.env.SUPABASE_URL}/rest/v1/patients?id=eq.{id}`,
            method: 'PATCH',
            headers: {
              'apikey': process.env.SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
              'Content-Type': 'application/json',
            },
          },
          getPatientByPhone: {
            url: `${process.env.SUPABASE_URL}/rest/v1/patients?phone=eq.{phone}`,
            method: 'GET',
            headers: {
              'apikey': process.env.SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
            },
          },
          logInteraction: {
            url: `${process.env.SUPABASE_URL}/rest/v1/interactions`,
            method: 'POST',
            headers: {
              'apikey': process.env.SUPABASE_ANON_KEY,
              'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
              'Content-Type': 'application/json',
            },
          },
        },
      },
    },

    // Web Search
    {
      id: 'tool-web',
      name: '@deepseek-ai/dsh-tool-web',
      config: {
        enabled: true,
        searchProvider: 'duckduckgo',
      },
    },

    // Voice Input
    {
      id: 'ears',
      name: 'dsh-ears',
      config: {
        enabled: true,
        backend: 'browser',
        autoTranscribe: true,
      },
    },
  ],

  // ─── AGENT SETTINGS ──────────────────────────────────────
  agent: {
    maxSteps: 20,
    allowSubAgents: true,
    // The branch data is available in the context
    context: {
      branches: branches.branches,
    },
  },
};
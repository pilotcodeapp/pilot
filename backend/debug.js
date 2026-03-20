const pty = require('node-pty');

const CLAUDE_PATH = '/Users/alexbruns/.local/bin/claude';

const p = pty.spawn(CLAUDE_PATH, [
  '--output-format', 'stream-json',
  '--verbose',
  '--dangerously-skip-permissions',
  '-p', 'list files in this directory'
], {
  name: 'xterm-256color',
  cols: 220,
  rows: 50,
  cwd: '/Users/alexbruns/rx-defender',
  env: {
    ...process.env,
    PATH: `/Users/alexbruns/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH}`,
    TERM: 'xterm-256color'
  }
});

p.onData(data => {
  const clean = data.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '');
  const lines = clean.split('\n').filter(l => l.trim());
  lines.forEach(line => {
    try {
      const parsed = JSON.parse(line.trim());
      if (parsed.type === 'assistant') {
        console.log('ASSISTANT CONTENT:');
        console.log(JSON.stringify(parsed.message.content, null, 2));
      }
    } catch(e) {
      console.log('RAW:', line.trim());
    }
  });
});

p.onExit(() => process.exit());

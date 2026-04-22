module.exports = {
  apps: [{
    name: 'pulse',
    script: './src/server.js',
    node_args: '--enable-source-maps',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production'
    },
    error_file: '/var/log/pulse/error.log',
    out_file: '/var/log/pulse/out.log',
    merge_logs: true,
    time: true
  }]
};

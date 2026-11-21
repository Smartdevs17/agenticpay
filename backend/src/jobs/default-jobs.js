"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultJobs = void 0;
exports.defaultJobs = [
    {
        id: 'system-heartbeat',
        name: 'System heartbeat log',
        schedule: { type: 'cron', expression: '*/5 * * * *' },
        handler: function () {
            console.log('[jobs] heartbeat', new Date().toISOString());
        },
    },
];

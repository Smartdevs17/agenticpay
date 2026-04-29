"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startJobs = startJobs;
exports.getJobScheduler = getJobScheduler;
var scheduler_js_1 = require("./scheduler.js");
var default_jobs_js_1 = require("./default-jobs.js");
var scheduler = null;
function startJobs() {
    if (scheduler) {
        return scheduler;
    }
    scheduler = new scheduler_js_1.JobScheduler();
    for (var _i = 0, defaultJobs_1 = default_jobs_js_1.defaultJobs; _i < defaultJobs_1.length; _i++) {
        var job = defaultJobs_1[_i];
        scheduler.addJob(job);
    }
    return scheduler;
}
function getJobScheduler() {
    return scheduler;
}

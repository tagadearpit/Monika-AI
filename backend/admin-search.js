'use strict';

/**
 * Builds the three un-executed Mongoose query objects used by the admin search route.
 * Extracted for unit-testability — no DB connection required.
 *
 * @param {{ Message: object, User: object, AuditEvent: object, mongoose: object }} models
 * @param {RegExp} regex   - already-escaped, case-insensitive search regex
 * @returns {[object, object, object]}  [userQuery, auditQuery, reportQuery]
 */
function buildAdminSearchQueries({ Message, User, AuditEvent, mongoose }, regex) {
    // codeql[js/nosql-injection]
    const userQuery = User.find(mongoose.trusted({ $or: [{ sessionId: regex }, { suspensionReason: regex }] })).limit(20).lean();
    // codeql[js/nosql-injection]
    const auditQuery = AuditEvent.find(mongoose.trusted({ $or: [{ userId: regex }, { action: regex }, { requestId: regex }] })).sort({ createdAt: -1 }).limit(30).lean();
    // codeql[js/nosql-injection]
    const reportQuery = Message.find({ 'feedback.reportType': mongoose.trusted({ $ne: null }), $or: [{ userId: regex }, { content: regex }] })
        .sort({ 'feedback.updatedAt': -1 })
        .limit(20)
        .select('userId conversationId content feedback createdAt')
        .lean();
    return [userQuery, auditQuery, reportQuery];
}

module.exports = { buildAdminSearchQueries };

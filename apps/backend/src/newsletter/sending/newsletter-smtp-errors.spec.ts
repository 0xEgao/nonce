import {
    classifySmtpError,
    describeSmtpError,
    describeThrottle,
} from '@/newsletter/sending/newsletter-smtp-errors';

// Shaped like nodemailer's errors: `code` is its own category, `response`
// the server's reply, `responseCode` its leading number, `command` the SMTP
// command that drew the reply.
function smtpError(
    response: string,
    fields: { code?: string; command?: string } = {},
): Error {
    return Object.assign(new Error(`Message failed: ${response}`), {
        code: fields.code ?? 'EENVELOPE',
        command: fields.command ?? 'RCPT TO',
        response,
        responseCode: Number(response.slice(0, 3)),
    });
}

function systemError(code: string, message: string): Error {
    return Object.assign(new Error(message), { code });
}

describe('classifySmtpError', () => {
    describe('throttled: pause the whole send, spend no attempts', () => {
        it.each([
            [
                'Gmail daily sending limit',
                smtpError(
                    '550 5.4.5 Daily user sending limit exceeded. For more information on Gmail sending limits go to https://support.google.com/a/answer/166852',
                    { code: 'EMESSAGE', command: 'DATA' },
                ),
            ],
            [
                'Gmail relay daily limit (5.7.1 but quota wording)',
                smtpError(
                    '550 5.7.1 Daily SMTP relay limit exceeded for customer.',
                    { code: 'EENVELOPE', command: 'MAIL FROM' },
                ),
            ],
            [
                'Gmail temporary system problem',
                smtpError(
                    '421 4.7.0 Temporary System Problem.  Try again later (10). d2e1a72fcca58-7',
                    { code: 'EENVELOPE', command: 'MAIL FROM' },
                ),
            ],
            [
                'try again later at RCPT time',
                smtpError('421 4.7.0 Try again later, closing connection.'),
            ],
            [
                'too many login attempts',
                smtpError(
                    '454 4.7.0 Too many login attempts, please try again later.',
                    { code: 'EAUTH', command: 'AUTH PLAIN' },
                ),
            ],
            [
                'bad credentials',
                smtpError(
                    '535-5.7.8 Username and Password not accepted. For more information, go to\n535 5.7.8  https://support.google.com/mail/?p=BadCredentials',
                    { code: 'EAUTH', command: 'AUTH PLAIN' },
                ),
            ],
            [
                'app password required',
                smtpError('534-5.7.9 Application-specific password required.', {
                    code: 'EAUTH',
                    command: 'AUTH PLAIN',
                }),
            ],
            ['EAUTH without a reply', systemError('EAUTH', 'Invalid login')],
            [
                'connection timeout',
                systemError('ETIMEDOUT', 'Connection timeout'),
            ],
            [
                'connection refused',
                systemError('ESOCKET', 'connect ECONNREFUSED 127.0.0.1:465'),
            ],
            ['DNS failure', systemError('EDNS', 'getaddrinfo ENOTFOUND')],
            [
                'generic 451',
                smtpError(
                    '451 4.3.0 Mail server temporarily rejected message.',
                    {
                        command: 'DATA',
                    },
                ),
            ],
            [
                'sender rejected at MAIL FROM',
                smtpError(
                    '553 5.7.1 <newsletter@bitshala.org>: Sender address rejected: not owned by user',
                    { command: 'MAIL FROM' },
                ),
            ],
        ])('%s', (_label, error) => {
            expect(classifySmtpError(error)).toBe('throttled');
        });
    });

    describe('bounced: suppress the address', () => {
        it.each([
            [
                'Gmail no such user (multi-line)',
                smtpError(
                    "550-5.1.1 The email account that you tried to reach does not exist. Please try\n550-5.1.1 double-checking the recipient's email address for typos or\n550-5.1.1 unnecessary spaces. For more information, go to\n550 5.1.1  https://support.google.com/mail/?p=NoSuchUser 41be03b00d2f7-b0c",
                ),
            ],
            [
                'domain not found',
                smtpError(
                    "553-5.1.2 We weren't able to find the recipient domain. Please check for any\n553 5.1.2 spelling errors.",
                ),
            ],
            [
                'mailbox disabled',
                smtpError(
                    '550 5.2.1 The email account that you tried to reach is disabled.',
                ),
            ],
            [
                'no enhanced code, user unknown',
                smtpError('550 <x@example.com>: User unknown'),
            ],
            ['551 user not local', smtpError('551 User not local')],
        ])('%s', (_label, error) => {
            expect(classifySmtpError(error)).toBe('bounced');
        });
    });

    describe('failed: retry, up to the attempt limit', () => {
        it.each([
            [
                // "quota" in the text, but it is the recipient's mailbox: pausing
                // for it would stall the whole send on one address.
                'recipient inbox over quota',
                smtpError(
                    "452-4.2.2 The recipient's inbox is out of storage space. Please direct the\n452 4.2.2 recipient to https://support.google.com/mail/?p=OverQuotaTemp",
                ),
            ],
            [
                'recipient receiving too fast',
                smtpError(
                    '450 4.2.1 The user you are trying to contact is receiving mail at a rate that prevents additional messages from being delivered.',
                ),
            ],
            [
                'permanent over-quota mailbox',
                smtpError(
                    '552 5.2.2 The email account that you tried to reach is over quota.',
                ),
            ],
            [
                'message too large',
                smtpError('552 5.3.4 Message size exceeds fixed limit', {
                    command: 'DATA',
                }),
            ],
            [
                'content rejected',
                smtpError('554 5.7.0 Message rejected: content policy', {
                    command: 'DATA',
                }),
            ],
            ['a plain error', new Error('Something went wrong')],
            ['not even an error', 'boom'],
            ['undefined', undefined],
        ])('%s', (_label, error) => {
            expect(classifySmtpError(error)).toBe('failed');
        });
    });

    it('never bounces a recipient over a sender-side 5.1.x', () => {
        // 5.1.8: bad sender's system address. Every recipient would get it.
        expect(
            classifySmtpError(
                smtpError(
                    '553 5.1.8 <newsletter@bitshala.org>: Sender address rejected: Domain not found',
                ),
            ),
        ).not.toBe('bounced');
        expect(
            classifySmtpError(
                smtpError('550 5.1.1 Sender unknown', { command: 'MAIL FROM' }),
            ),
        ).toBe('throttled');
    });
});

describe('describeSmtpError', () => {
    it('joins a multi-line reply and keeps the codes once', () => {
        expect(
            describeSmtpError(
                smtpError(
                    '550-5.1.1 The email account that you tried to reach does not exist. Please try\n550-5.1.1 double-checking the recipient address.\n550 5.1.1  https://support.google.com/mail/?p=NoSuchUser',
                ),
            ),
        ).toBe(
            '550 5.1.1 The email account that you tried to reach does not exist. Please try double-checking the recipient address. https://support.google.com/mail/?p=NoSuchUser',
        );
    });

    it('names the code of a connection error', () => {
        expect(
            describeSmtpError(systemError('ETIMEDOUT', 'Connection timeout')),
        ).toBe('ETIMEDOUT: Connection timeout');
    });

    it('caps the length', () => {
        expect(
            describeSmtpError(new Error('x'.repeat(2000))).length,
        ).toBeLessThanOrEqual(500);
    });
});

describe('describeThrottle', () => {
    it('explains each cause in words', () => {
        expect(describeThrottle(systemError('EAUTH', 'Invalid login'))).toMatch(
            /rejected the newsletter SMTP login/,
        );
        expect(
            describeThrottle(systemError('ETIMEDOUT', 'Connection timeout')),
        ).toMatch(/Could not reach the mail server/);
        expect(
            describeThrottle(
                smtpError('550 5.4.5 Daily user sending limit exceeded.', {
                    command: 'DATA',
                }),
            ),
        ).toMatch(/daily sending quota is used up.*5\.4\.5 Daily user/);
    });
});

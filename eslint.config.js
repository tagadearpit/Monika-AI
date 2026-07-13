'use strict';

const commonRules = {
    'no-undef': 'error',
    'no-unreachable': 'error',
    'no-dupe-keys': 'error',
    'no-func-assign': 'error',
    'no-constant-condition': 'error',
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^(?:_|error)$' }]
};

module.exports = [
    {
        files: ['backend/*.js', 'backend/test/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: {
                require: 'readonly', module: 'readonly', __dirname: 'readonly', process: 'readonly',
                console: 'readonly', Buffer: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
                setInterval: 'readonly', clearInterval: 'readonly', setImmediate: 'readonly', URL: 'readonly'
            }
        },
        rules: commonRules
    },
    {
        files: ['public/script.js', 'public/admin.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'script',
            globals: {
                window: 'readonly', document: 'readonly', navigator: 'readonly', localStorage: 'readonly',
                sessionStorage: 'readonly', fetch: 'readonly', Headers: 'readonly', AbortController: 'readonly',
                BroadcastChannel: 'readonly', SpeechSynthesisUtterance: 'readonly', firebase: 'readonly',
                google: 'readonly', alert: 'readonly', confirm: 'readonly', prompt: 'readonly', setTimeout: 'readonly',
                clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', location: 'readonly',
                console: 'readonly', Notification: 'readonly', URL: 'readonly', TextDecoder: 'readonly',
                Uint8Array: 'readonly', atob: 'readonly', btoa: 'readonly', Date: 'readonly', Blob: 'readonly', requestAnimationFrame: 'readonly'
            }
        },
        rules: commonRules
    },
    {
        files: ['public/sw.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'script',
            globals: { self: 'readonly', caches: 'readonly', fetch: 'readonly', URL: 'readonly' }
        },
        rules: commonRules
    }
];

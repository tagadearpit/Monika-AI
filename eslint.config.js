'use strict';

module.exports = [
    {
        files: ['backend/server.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: {
                require: 'readonly',
                module: 'readonly',
                __dirname: 'readonly',
                process: 'readonly',
                console: 'readonly',
                Buffer: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly'
            }
        },
        rules: {
            'no-undef': 'error',
            'no-unreachable': 'error',
            'no-dupe-keys': 'error',
            'no-func-assign': 'error',
            'no-constant-condition': 'error',
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^(?:_|error)$' }]
        }
    },
    {
        files: ['public/script.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'script',
            globals: {
                window: 'readonly',
                document: 'readonly',
                navigator: 'readonly',
                localStorage: 'readonly',
                sessionStorage: 'readonly',
                fetch: 'readonly',
                Headers: 'readonly',
                AbortController: 'readonly',
                BroadcastChannel: 'readonly',
                SpeechSynthesisUtterance: 'readonly',
                firebase: 'readonly',
                google: 'readonly',
                grecaptcha: 'readonly',
                alert: 'readonly',
                confirm: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                location: 'readonly',
                console: 'readonly'
            }
        },
        rules: {
            'no-undef': 'error',
            'no-unreachable': 'error',
            'no-dupe-keys': 'error',
            'no-func-assign': 'error',
            'no-constant-condition': 'error',
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^(?:_|error)$' }]
        }
    },
    {
        files: ['public/sw.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'script',
            globals: {
                self: 'readonly',
                caches: 'readonly',
                fetch: 'readonly',
                URL: 'readonly'
            }
        },
        rules: {
            'no-undef': 'error',
            'no-unreachable': 'error',
            'no-dupe-keys': 'error'
        }
    }
];

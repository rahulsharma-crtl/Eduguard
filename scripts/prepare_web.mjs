import { mkdirSync, cpSync } from 'node:fs';
for (const role of ['student','teacher']) {
    const destination = `web/public/classroom/${role}`;
    mkdirSync(destination, {recursive:true});
    cpSync(`components/${role}_room/frontend`, destination, {recursive:true});
}

// Isolated, direct-link research page. Existing classroom copy paths above are unchanged.
mkdirSync('web/public/classroom/validation', {recursive:true});
cpSync('components/facial_validation/frontend', 'web/public/classroom/validation', {recursive:true});

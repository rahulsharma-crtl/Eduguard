import { mkdirSync, cpSync } from 'node:fs';
for (const role of ['student','teacher']) {
    const destination = `web/public/classroom/${role}`;
    mkdirSync(destination, {recursive:true});
    cpSync(`components/${role}_room/frontend`, destination, {recursive:true});
}

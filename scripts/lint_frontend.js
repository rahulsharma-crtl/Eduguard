const fs = require('fs');
const vm = require('vm');
const path = require('path');

const files = [
    'components/student_room/frontend/index.html',
    'components/teacher_room/frontend/index.html'
];

let hasErrors = false;

files.forEach(file => {
    const fullPath = path.resolve(__dirname, '..', file);
    if (!fs.existsSync(fullPath)) {
        console.error(`File not found: ${fullPath}`);
        hasErrors = true;
        return;
    }

    const content = fs.readFileSync(fullPath, 'utf8');
    const scripts = content.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi) || [];
    
    console.log(`Checking ${file}: found ${scripts.length} inline script block(s).`);

    scripts.forEach((scriptTag, idx) => {
        const code = scriptTag.replace(/<script[^>]*>|<\/script>/gi, '');
        try {
            new vm.Script(code, { filename: `${file}#script[${idx}]` });
            console.log(`  ✓ Script block ${idx}: Syntax valid.`);
        } catch (err) {
            console.error(`  ✗ Script block ${idx} syntax error:`, err.message);
            hasErrors = true;
        }
    });
});

if (hasErrors) {
    process.exit(1);
} else {
    console.log('All frontend script checks passed successfully.');
}

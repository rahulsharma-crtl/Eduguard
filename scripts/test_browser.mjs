import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
const env={...process.env,VITE_API_URL:'http://localhost:8000'};
for(const args of [['scripts/build_engagement.mjs'],['scripts/prepare_web.mjs'],['node_modules/vite/bin/vite.js','build'],
 ['--test','--test-concurrency=1',...readdirSync('tests/browser').filter(name=>name.endsWith('.test.mjs')).map(name=>'tests/browser/'+name)]]){
 const result=spawnSync(process.execPath,args,{env,stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);
}

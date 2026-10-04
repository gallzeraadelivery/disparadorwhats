const {spawnSync}=require('node:child_process');
function run(args){const r=spawnSync('npm',args,{encoding:'utf8',maxBuffer:10*1024*1024});let b;try{b=JSON.parse(r.stdout);}catch{throw Error('Dependency audit did not return JSON');}if(b.error||r.status>1)throw Error('Dependency audit failed');return b;}
run(['audit','fix','--ignore-scripts','--omit=dev','--no-fund','--json']);
const report=run(['audit','--omit=dev','--json']);
console.log(JSON.stringify({vulnerabilities:report.metadata?.vulnerabilities}));
if(report.metadata?.vulnerabilities?.critical>0)throw Error('Candidate still has critical dependency advisories');

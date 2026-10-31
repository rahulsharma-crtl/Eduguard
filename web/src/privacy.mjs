export function sanitizeTelemetry(value) {
 if(!value || typeof value!=='object'||Array.isArray(value)||typeof value.sample_id!=='string'||!/^[0-9a-f-]{36}$/i.test(value.sample_id))throw Error('Invalid observation message');
 if(typeof value.is_unknown!=='boolean'||typeof value.status!=='string'||value.status.length>120)throw Error('Invalid observation fields');
 const result={sample_id:value.sample_id,is_unknown:value.is_unknown,status:value.status};
 for(const key of ['cei_score','attentiveness','distraction']){
  const number=value[key];if(!(value.is_unknown&&number===null)&&(!Number.isFinite(number)||number<0||number>1))throw Error('Invalid observation score');result[key]=number;
 }
 return result;
}

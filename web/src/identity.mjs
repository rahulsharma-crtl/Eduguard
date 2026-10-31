export function participantId(storage,room,retentionMs=7*86400000){
 const key=`eduguard-participant:${room}`;let saved;
 try{saved=JSON.parse(storage.getItem(key))}catch{const legacy=storage.getItem(key);if(legacy)saved={id:legacy,expiresAt:Date.now()+retentionMs}}
 if(!saved?.id||saved.expiresAt<Date.now())saved={id:crypto.randomUUID(),expiresAt:Date.now()+retentionMs};
 storage.setItem(key,JSON.stringify(saved));return saved.id;
}
export function purgeExpiredCredentials(storage){
 for(const key of Object.keys(storage)){
  if(!key.startsWith('eduguard-student-session:')&&!key.startsWith('eduguard-participant:')&&key!=='eduguard-teacher-session')continue;
  try{const value=JSON.parse(storage.getItem(key));const expires=value?.local_expires_at||value?.expiresAt;if(expires&&expires<Date.now())storage.removeItem(key)}catch{}
 }
}

// Rendering-only overlay. Raw normalized landmarks remain unchanged for inference.
export function renderMesh(canvas,landmarks,{enabled=true,draw=globalThis.drawConnectors,connections=globalThis.FACEMESH_TESSELATION}={}){
 const ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);
 if(!enabled||!landmarks||!draw||!connections)return;
 draw(ctx,landmarks,connections,{color:'rgba(0,255,180,0.55)',lineWidth:1});
 for(const [edges,color] of [[globalThis.FACEMESH_FACE_OVAL,'#4e6bff'],[globalThis.FACEMESH_LEFT_EYE,'#00b9d6'],[globalThis.FACEMESH_RIGHT_EYE,'#00b9d6'],[globalThis.FACEMESH_LIPS,'#f04e8d']])if(edges)draw(ctx,landmarks,edges,{color,lineWidth:1.5});
}

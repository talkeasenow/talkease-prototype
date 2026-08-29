const express=require("express");
const http=require("http");
const {Server}=require("socket.io");
const path=require("path");

const app=express();
const server=http.createServer(app);
const io=new Server(server);
app.use(express.static(path.join(__dirname,"public")));

let talkers=[];
const listeners=new Map();
const pairs=new Map();

function clean(){
  talkers=talkers.filter(id=>io.sockets.sockets.has(id));
  for(const id of listeners.keys()){
    if(!io.sockets.sockets.has(id)) listeners.delete(id);
  }
}
function match(){
  clean();
  while(talkers.length && listeners.size){
    const a=talkers.shift();
    const it=listeners.keys().next();
    if(it.done){talkers.unshift(a);return;}
    const b=it.value;
    if(!io.sockets.sockets.has(a)||!io.sockets.sockets.has(b)) continue;
    listeners.delete(b);
    const room=`room-${a}-${b}`;
    pairs.set(a,{peer:b,room});
    pairs.set(b,{peer:a,room});
    io.to(a).emit("matched",{room,peer:io.sockets.sockets.get(b).data.name});
    io.to(b).emit("matched",{room,peer:io.sockets.sockets.get(a).data.name});
  }
}
io.on("connection",s=>{
  s.on("join_queue",({role,name})=>{
    s.data.role=role;
    s.data.name=(name||"Anonymous").slice(0,30);
    if(role==="talker"){
      if(!talkers.includes(s.id)) talkers.push(s.id);
      s.emit("waiting","Looking for someone who's available to listen…");
    }else{
      listeners.set(s.id,s.data.name);
      s.emit("waiting","You're available. Waiting for someone who wants to talk…");
    }
    match();
  });
  s.on("send_message",({room,text})=>{
    const p=pairs.get(s.id);
    if(!p||p.room!==room) return;
    text=String(text||"").trim().slice(0,1000);
    if(text) io.to(room).emit("message",{text,sender:s.id});
  });
  s.on("end",()=>{
    const p=pairs.get(s.id);
    if(!p) return;
    pairs.delete(s.id); pairs.delete(p.peer);
    io.to(p.peer).emit("ended"); s.emit("ended");
  });
  s.on("cancel",()=>{
    talkers=talkers.filter(x=>x!==s.id);
    listeners.delete(s.id);
  });
  s.on("disconnect",()=>{
    talkers=talkers.filter(x=>x!==s.id);
    listeners.delete(s.id);
    const p=pairs.get(s.id);
    if(p){
      pairs.delete(s.id); pairs.delete(p.peer);
      io.to(p.peer).emit("ended");
    }
  });
});
server.listen(process.env.PORT||3000,()=>console.log("TalkEase prototype running"));

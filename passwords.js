const crypto=require('node:crypto');const {promisify}=require('node:util');const scrypt=promisify(crypto.scrypt);
async function passwordHash(password){const salt=crypto.randomBytes(16).toString('hex');return 'scrypt$'+salt+'$'+(await scrypt(password,salt,64)).toString('hex');}
async function verifyPassword(password,stored){
 if(typeof stored!=='string')return false;
 if(/^[a-f0-9]{64}$/.test(stored))return crypto.timingSafeEqual(Buffer.from(stored,'hex'),crypto.createHash('sha256').update(password).digest());
 const [kind,salt,hash]=stored.split('$');if(kind!=='scrypt'||!/^[a-f0-9]{32}$/.test(salt||'')||!/^[a-f0-9]{128}$/.test(hash||''))return false;
 return crypto.timingSafeEqual(Buffer.from(hash,'hex'),await scrypt(password,salt,64));
}
module.exports={passwordHash,verifyPassword};

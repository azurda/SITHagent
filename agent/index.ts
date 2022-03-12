// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.


/* SITHagent
* author: @entdark_
* This is a proof of concept proxy that interacts with the quake virtual
* machine to provide anti-cheat capabilities on the legacy server binaries
* for JA 1.00 and 1.01.
*
* how to run:
*   frida -l agent.js linuxjampded
*/

// @ts-nocheck

export const currentFrame: NativePointer = Memory.alloc(4);

import { runFrameCModule } from "./cfunctions";
import { log } from "./logger";
import { bannedIPsArray, GAME_DLL, ipKey, MAX_INFO_STRING, qTrue, rateKey, snapsKey, SV_TICKRATE } from "./settings";
import { SITHagent_timenudgeValidation, SITHagent_sendServerChatMessage } from "./sithagent";

const modules: Module[] = Process.enumerateModules();
let jampgame_exports: ModuleExportDetails[] = [];
let clientList: boolean[] = [];
let hookedFunctions: InvocationListener[] = [];

// native functions
export let InfoValueforKey: NativeFunction;
let getUserInfo: NativeFunction;
export let trap_SendConsoleCommand: NativeFunction;
// fpointers
let ClientConnectPtr: NativePointer;
let GsayPtr: NativePointer;
let GRunFramePtr: NativePointer;
let ClientUserInfoChangedPtr: NativePointer;
let ClientBeginPtr: NativePointer;
let PlayerDiePtr: NativePointer;
let GShutdownGamePtr: NativePointer;

// We need qboolean G_FilterPacket(char *) to make bans work without having any
// heavy impact on the whole ClientConnect function.
let G_FilterPacketPtr: NativePointer;

// Get jampgamei386 fpointers.
modules.forEach(function (value) {
  if (value.name == GAME_DLL) {
    jampgame_exports = value.enumerateExports();
    return false;
  }
});

if (jampgame_exports.length == 0 || jampgame_exports === undefined) {
  log('WARNING: jampgamei386 exports not found.');
}

// only functions to intercept.
jampgame_exports.forEach(function (value: any) {
  switch (value.name) {
    case "Info_ValueForKey__FPCcT1":
      InfoValueforKey = new NativeFunction(ptr(value.address), 'pointer', ['pointer', 'pointer']);
      log("nf: InfoValueforKey@" + value.address);
      break;
    case "trap_GetUserinfo__FiPcT1":
      getUserInfo = new NativeFunction(ptr(value.address), 'void', ['int', 'pointer', 'int']);
      log("nf: trap_GetUserinfo__FiPcT1@" + value.address);
      break;
    case "G_FilterPacket__FPc":
      G_FilterPacketPtr = ptr(value.address);
      log("nf: G_FilterPacket__FPc@" + value.address);
      break;
    case "trap_SendConsoleCommand__FiPCc":
      trap_SendConsoleCommand = new NativeFunction(ptr(value.address), 'void', ['int', 'pointer']);
      (global as any).trap = trap_SendConsoleCommand;
      log("nf: trap_SendConsoleCommand__FiPCc@" + value.address);
    case "G_RunFrame__Fi":
      GRunFramePtr = ptr(value.address);
      break;
  }
});

class ClientConnect {
  onEnter(args: NativePointer[]) {
    let userinfo = Memory.alloc(MAX_INFO_STRING);  // size: 1024 or game goes brrrr
    let isBot = 0;
    const clientId: number = args[0].toInt32();
    if (args[2].toInt32() == 1) {
      isBot = 1
      log('(bot) clientConnect: ' + clientId);
      clientList[clientId] = false;
    }
    else {
      clientList[clientId] = true;
      log('clientConnect: ' + clientId);
    }

    if (!isBot) {
      getUserInfo(clientId, userinfo, MAX_INFO_STRING);
      let tmpIp: any = InfoValueforKey(userinfo, ipKey);
      const clientIP: string | null = tmpIp.readUtf8String();

      log("clientIP: " + tmpIp.readUtf8String());
      if (bannedIPsArray.includes(tmpIp.readUtf8String())) {
        // if banned, we ban :)
        log('filtered: ' + clientIP);
        Interceptor.replace(G_FilterPacketPtr, new NativeCallback((packet) => {
          return qTrue;
        }, 'bool', ['pointer']));
      }
    }

    const tmpSnaps: any = InfoValueforKey(userinfo, snapsKey);
    log("Snaps: " + tmpSnaps.readUtf8String());
    const tmpRate: any = InfoValueforKey(userinfo, rateKey);
    log("Rate: " + tmpRate.readUtf8String());
    let nameKey = Memory.allocUtf8String("name");
    const tmpName: any = InfoValueforKey(userinfo, nameKey);
    log("playername: " + tmpName.readUtf8String());
  }
  onLeave() {
    Interceptor.revert(G_FilterPacketPtr);
  }
}

class ClientUserInfoChanged {
  onEnter(args: NativePointer[]) {
    let userinfo = Memory.alloc(MAX_INFO_STRING);

    const clientId: number = args[0].toInt32();
    log('userinfo changed: ' + clientId);

    getUserInfo(clientId, userinfo, MAX_INFO_STRING);

    const tmpSnaps: any = InfoValueforKey(userinfo, snapsKey);
    const snaps = tmpSnaps.readUtf8String();
    log("Snaps: " + tmpSnaps.readUtf8String());
    const tmpRate: any = InfoValueforKey(userinfo, rateKey);
    const rate = tmpRate.readUtf8String();
    log("Rate: " + tmpRate.readUtf8String());
    let nameKey = Memory.allocUtf8String("name");
    const tmpName: any = InfoValueforKey(userinfo, nameKey);
    log("playername: " + tmpName.readUtf8String());

    if (parseInt(snaps) > SV_TICKRATE) {
      log("detected invalid snaps: " + parseInt(snaps) + " for client " + clientId);
      const clientKickString = Memory.allocUtf8String("clientkick " + clientId.toString() + "\n");
      trap_SendConsoleCommand(0, clientKickString);
    }

    if (parseInt(rate) != 25000) {
      log("detected invalid rate: " + parseInt(rate) + " for client " + clientId);
      const clientKickString = Memory.allocUtf8String("clientkick " + clientId.toString() + "\n");
      trap_SendConsoleCommand(0, clientKickString);
    }
  }
}

class PlayerDie {

  killer_clientNum: number = -1;
  killer_cmdTime: number = 0;
  killer_clientPing: number = 999;
  onEnter(args: NativePointer[]) {
    this.killer_clientNum = args[2].readInt();
    log('player_die()');
    log('\tclientId: ' + this.killer_clientNum);

    const killer_playerState_s: NativePointer = args[2].add(532);

    this.killer_cmdTime = killer_playerState_s.readPointer().readInt();
    this.killer_clientPing = killer_playerState_s.readPointer().add(524).readInt();

    log("\tping: " + this.killer_clientPing);
    log("\tcmdTime:" + this.killer_cmdTime);
    log("\tlevelTime: " + currentFrame.readInt());
  }

  onLeave() {
    if (clientList[this.killer_clientNum]) {
      //let timenudge:number = ((this.killer_cmdTime - levelTime) + this.killer_clientPing - 22 + (1000/SV_TICKRATE)) * -1;
      let { timenudge, bogusTimenudge } = SITHagent_timenudgeValidation(this.killer_cmdTime, currentFrame.readInt(), this.killer_clientPing);
      log("\ttimenudge: " + timenudge);
      if (bogusTimenudge === true) {
        SITHagent_sendServerChatMessage("timenudge: " + timenudge.toString());
        log("detected bogus timenudge: " + timenudge + " for client " + this.killer_clientNum);
        // drop client
        const killer_clientKickString = Memory.allocUtf8String("clientkick " + this.killer_clientNum.toString() + "\n");
        trap_SendConsoleCommand(0, killer_clientKickString);
      }
    }
  }
}

class GSay {
  clientNum: number = -1;
  cmdTime: number = 0;
  clientPing: number = 999;

  onEnter(args: NativePointer[]) {
    this.clientNum = args[0].readInt();
    log('gsay()');
    log('\tclientId: ' + this.clientNum);

    const playerState_s: NativePointer = args[0].add(532);

    this.cmdTime = playerState_s.readPointer().readInt();
    this.clientPing = playerState_s.readPointer().add(524).readInt();

    log("\tping: " + this.clientPing);
    log("\tcmdTime:" + this.cmdTime);
    log("\tlevelTime: " + currentFrame.readInt());
  }

  onLeave() {
    if (clientList[this.clientNum]) {
      let timenudge: number = ((this.cmdTime - currentFrame.readInt()) + this.clientPing - 19 + (1000 / 40)) * -1;
      if ((timenudge > this.clientPing * 2) || (timenudge < -5)) {
        console.log("detected bougs timenudge: " + timenudge + " for client " + this.clientNum);
        // drop client
        const clientKickString = Memory.allocUtf8String("clientkick " + this.clientNum.toString() + "\n");
        trap_SendConsoleCommand(0, clientKickString);
        log("\ttimenudge: " + timenudge);
      }

    }
  }
}

class GShutDownGame {
  onLeave() {
    setTimeout(hookJampgameExports, 3000);
    log("Reloading hooks.");
  }
}

class ClientBegin {
  onLeave() {
    SITHagent_sendServerChatMessage("[SITHagent 0.1] This server is running an anti-cheat system.");
  }
}

function hookJampgameExports() {

  if (hookedFunctions) {
    hookedFunctions.forEach(function (value: InvocationListener) {
      value.detach()
    });
  }

  /* jampgamei386 exports
* Exports that are going ot be instrumented from the jampgamei386.so library.
 */
  jampgame_exports.forEach(function (value: any) {
    let tmp: InvocationListener;
    switch (value.name) {
      case "ClientConnect__Fi8qbooleanT2":
        ClientConnectPtr = ptr(value.address);
        log("nf: ClientConnect__Fi8qbooleanT2 @ " + value.address);
        tmp = Interceptor.attach(ClientConnectPtr, new ClientConnect);
        hookedFunctions.push(tmp);
        break;
      /*case "G_Say__FP9gentity_sT1iPCc":
        GsayPtr = ptr(value.address);
        log('nf: G_Say__FP9gentity_sT1iPCc@' + value.address);
        tmp = Interceptor.attach(GsayPtr, new GSay);
        hookedFunctions.push(tmp);
        break;
        */
      case "G_RunFrame__Fi":
        GRunFramePtr = ptr(value.address);
        log('nf: G_RunFrame__Fi@' + value.address);
        //tmp = Interceptor.attach(GRunFramePtr, new G_RunFrame);
        tmp = Interceptor.attach(GRunFramePtr, runFrameCModule);
        log(hookedFunctions.toString());
        hookedFunctions.push(tmp);
        break;
      case "ClientUserinfoChanged__Fi":
        ClientUserInfoChangedPtr = ptr(value.address);
        log('nf: ClientUserinfoChanged__Fi@' + value.address);
        tmp = Interceptor.attach(ClientUserInfoChangedPtr, new ClientUserInfoChanged);
        hookedFunctions.push(tmp);
        break;
      case "player_die__FP9gentity_sN21iT4":
        PlayerDiePtr = ptr(value.address);
        log('nf: player_die__FP9gentity_sN21iT4' + value.address);
        tmp = Interceptor.attach(PlayerDiePtr, new PlayerDie);
        hookedFunctions.push(tmp);
        break;
      case "G_ShutdownGame__Fi":
        GShutdownGamePtr = ptr(value.address);
        log('nf: G_ShutdownGame__Fi' + value.address);
        tmp = Interceptor.attach(GShutdownGamePtr, new GShutDownGame);
        hookedFunctions.push(tmp);
        break;
      case "ClientBegin__Fi8qboolean":
        ClientBeginPtr = ptr(value.address);
        log('nf: ClientBegin__Fi8qboolean@' + value.address);
        Interceptor.attach(ClientBeginPtr, new ClientBegin);
        break;
      // ClientThink_real__FP9gentity_s
    }
  });

}

// initial hook.
hookJampgameExports();
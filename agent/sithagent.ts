import { InfoValueforKey, trap_SendConsoleCommand } from "./index";
import { snapsKey, rateKey, SV_TICKRATE, highPingCompensation } from "./settings";

export function SITHagent_userInfoValidation(userInfoPtr: NativePointer): boolean {
    if (InfoValueforKey(userInfoPtr, snapsKey).toString() != "25000") {
      return false;
    }
    if (InfoValueforKey(userInfoPtr, rateKey).toString() != SV_TICKRATE.toString()) {
      return false;
    }
    return true;
  }
  
export function SITHagent_timenudgeValidation(cmdTime: number, currentFrame: number, ping: number): { timenudge: number, bogusTimenudge: boolean } {
    let timenudge: number  =  ((cmdTime - currentFrame) + ping - highPingCompensation + (1000 / SV_TICKRATE)) * -1;
    /*if (ping > 50) {
      timenudge = ((cmdTime - currentFrame) + ping - highPingCompensation + (1000 / SV_TICKRATE)) * -1;
    } else {
      timenudge = ((cmdTime - currentFrame) + ping + (1000 / SV_TICKRATE)) * -1;
    }
    */
    let bogusTimenudge: boolean = timenudge >= ping || timenudge < -7;
    return { timenudge, bogusTimenudge }
  
  }
  
export function SITHagent_sendServerChatMessage(message: string): void {
    const serverMessageString = Memory.allocUtf8String("\"" + message + "\n\"");
    trap_SendConsoleCommand(0, serverMessageString);
  }
  
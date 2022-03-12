import { currentFrame } from "./index";

export const runFrameCModule: CModule = new CModule(`
#include <gum/guminterceptor.h>

extern int currentFrame;

void onEnter (GumInvocationContext *ic) 
{
  currentFrame = (int)gum_invocation_context_get_nth_argument(ic, 0);
}
`, { currentFrame });
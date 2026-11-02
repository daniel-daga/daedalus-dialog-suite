// #440: two statements sharing a source line stay on that line.
func void DIA_BodyInline_Info()
{
	AI_StopProcessInfos (self); Npc_ClearAIQueue (self);
	Npc_SetRefuseTalk (self, 300);
};

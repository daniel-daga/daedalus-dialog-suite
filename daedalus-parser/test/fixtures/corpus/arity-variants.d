func void B_RemoveVariants()
{
	Npc_RemoveInvItem (self, ItMi_Gold);
	Npc_RemoveInvItems (self, ItMi_Gold, 5);
	Npc_RemoveInvItems (self, ItMi_Gold);
	AI_Output (self, other);
};

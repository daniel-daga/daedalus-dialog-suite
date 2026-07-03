func void B_GiveGoldReward()
{
	CreateInvItems (self, ItMi_Gold, Gold_Amount);
	B_GiveInvItems (self, other, ItMi_Gold, 0);
	CreateInvItems (hero, ItMi_Gold, 100);
	B_Kapitelwechsel (KAPITEL_NR, NEWWORLD);
};

func void B_RefuseAndAttack()
{
	Npc_SetRefuseTalk (self, RefuseSeconds);
	Npc_SetRefuseTalk (self, 300);
	B_Attack (self, other, AR_None, ItemDamage);
	CreateInvItems (self, ItMi_Gold, -1);
};

instance ItMi_Gold (C_Item)
{
	name = "Gold";
	mainflag = ITEM_KAT_NONE;
	value = 1;
};

instance Some_NPC (C_Npc)
{
	name = "Grunt";
	level = 5;
	guild = GIL_MIL;
};

// end of items and npcs

instance BAU_900_Onar (Npc_Default)
{
	// ------ NSC ------
	name 		= "Onar";
	guild 		= GIL_BAU;
	id 			= 900;
	voice 		= 14;
	flags       = NPC_FLAG_IMMORTAL; // never dies
	npctype		= NPCTYPE_MAIN;
	aivar[AIV_ToughGuy] = TRUE;

	// ------ Attribute ------
	B_SetAttributesToChapter (self, 3);
	fight_tactic		= FAI_HUMAN_STRONG;
	EquipItem			(self, ItMw_1h_Bau_Mace);
	B_SetNpcVisual 		(self, MALE, "Hum_Head_Fatbald", Face_N_Weak_Orry, BodyTex_N, ITAR_Vlk_H);
	Mdl_SetVisual		(self, "HUMANS.MDS");
	Mdl_SetVisualBody	(self, "hum_body_Naked0", 0, 1, "Hum_Head_Bald", 12, 0, NO_ARMOR);
	Mdl_SetModelFatness	(self, 2);
	Mdl_ApplyOverlayMds	(self, "Humans_Arrogance.mds");
	B_GiveNpcTalents (self);
	B_SetFightSkills (self, 30);
	if (Kapitel >= 2) { level = 3; };
	daily_routine 		= Rtn_Start_900;
};

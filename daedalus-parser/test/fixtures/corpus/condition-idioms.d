func int DIA_Foo_Condition()
{
	// gate on prior knowledge of the topic
	if (Npc_KnowsInfo (other, DIA_Foo))
	{
		return TRUE;
	};
	return FALSE;
};

func int DIA_Bar_Condition()
{
	var int ok;
	ok = FALSE;
	if ((hero.guild == GIL_NONE) && (Npc_GetTrueGuild (self) == GIL_MIL))
	{
		ok = TRUE;
	};
	return ok;
};

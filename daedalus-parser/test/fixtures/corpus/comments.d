func void B_CommentCases()
{
	AI_Output (self, other, "DIA_Foo_15_00"); // spoken subtitle stays inline
	// standalone comment on its own line
	AI_StopProcessInfos (self);
	Npc_SetRefuseTalk (self, 300); // trailing note
};

// trailing comment at end of file

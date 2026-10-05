export const SAMPLE_MSPDI = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <Name>Bâtiment B12.xml</Name>
  <Title>Bâtiment B12</Title>
  <Tasks>
    <Task><UID>0</UID><ID>0</ID><Name>Bâtiment B12</Name><OutlineLevel>0</OutlineLevel><Summary>1</Summary></Task>
    <Task><UID>1</UID><ID>1</ID><Name>Gros œuvre</Name><OutlineLevel>1</OutlineLevel><Summary>1</Summary>
      <Start>2026-10-05T08:00:00</Start><Finish>2026-10-30T17:00:00</Finish></Task>
    <Task><UID>2</UID><ID>2</ID><Name>Ferraillage &amp; coffrage</Name><OutlineLevel>2</OutlineLevel>
      <Start>2026-10-05T08:00:00</Start><Finish>2026-10-09T17:00:00</Finish><PercentComplete>100</PercentComplete></Task>
    <Task><UID>3</UID><ID>3</ID><Name>Coulage</Name><OutlineLevel>2</OutlineLevel>
      <Start>2026-10-14T08:00:00</Start><Finish>2026-10-16T17:00:00</Finish><PercentComplete>20</PercentComplete>
      <Notes>Béton C30/37</Notes>
      <PredecessorLink><PredecessorUID>2</PredecessorUID><Type>1</Type><LinkLag>9600</LinkLag><LagFormat>7</LagFormat></PredecessorLink>
    </Task>
    <Task><UID>4</UID><ID>4</ID><Name>Radier coulé</Name><OutlineLevel>2</OutlineLevel><Milestone>1</Milestone>
      <Start>2026-10-16T17:00:00</Start><Finish>2026-10-16T17:00:00</Finish>
      <PredecessorLink><PredecessorUID>3</PredecessorUID><Type>0</Type></PredecessorLink>
      <PredecessorLink><PredecessorUID>99</PredecessorUID><Type>1</Type></PredecessorLink>
    </Task>
    <Task><UID>5</UID><ID>5</ID><Name>Réception</Name><OutlineLevel>1</OutlineLevel>
      <Start>2026-11-02T08:00:00</Start><Finish>2026-11-02T17:00:00</Finish></Task>
  </Tasks>
  <Resources><Resource><UID>1</UID><Name>Garonne Bâtiment</Name></Resource></Resources>
  <Assignments><Assignment><TaskUID>3</TaskUID><ResourceUID>1</ResourceUID></Assignment></Assignments>
</Project>`

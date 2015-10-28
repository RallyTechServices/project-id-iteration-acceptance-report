Ext.define('FakeStory', {
    extend: 'Ext.data.Model',
    fields: [
        {name: 'ObjectID',  type: 'int', defaultValue: -1},
        {name: 'PlanEstimate', type: 'int', defaultValue: 0},
        {name: 'Iteration', type:'object'},
        {name: 'Project', type:'object'},
        {name: 'Workspace', type:'object'}
    ]
});
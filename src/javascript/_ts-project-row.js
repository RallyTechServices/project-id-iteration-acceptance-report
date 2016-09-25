Ext.define('TSProjectRow',{
    extend: 'Ext.data.Model',
    fields: [
         {name: 'ProjectID', type:'string'},
         {name: 'Iteration', type: 'object' },

         {name: 'Project', type: 'object' },
         {name: 'Workspace', type: 'object' },
         {name: 'ProjectSource', type:'string'},
         {name: 'Artifacts', type:'object'},
         {name: 'PlanEstimate', type:'int', defaultValue: 0 },
         
         {name: '_total', type:'float', defaultValue: -1},
         {name: '_accepted_total', type:'float', defaultValue: -1},
         {name: '_accepted_percent', type:'float', defaultValue: -1}         
     ],
     
     addArtifact: function(artifact) {
         var artifacts = this.get('Artifacts') || [];
         
         artifacts.push(artifact);
         this.set('Artifacts', artifacts);
         
         this.set('Iteration', artifact.get('Iteration'));
         
         var size = artifact.get('PlanEstimate') || 0;
         var accepted_date = artifact.get('AcceptedDate');
         
         var total = this.get('_total') || 0;
         if ( total < 0 ) { total = 0; }
         var accepted_total = this.get('_accepted_total') || 0;
         if ( accepted_total < 0 ) { accepted_total = 0; }
         
         total = total + size;
         if ( accepted_date ) { accepted_total = accepted_total + size; }
         
         this.set('_total',total);
         this.set('_accepted_total', accepted_total);
         if ( total > 0 ) {
             this.set('_accepted_percent', accepted_total/total);
         }

     }
});